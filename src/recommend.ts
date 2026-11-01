import { wearLevel } from './frequency'
import { CATEGORIES } from './types'
import type { Category, OutfitRecord, Season, Settings, WardrobeItem } from './types'
import type { DayInfo, Weather } from './weather'

/** 推荐里的位置：上衣+下装 或 连衣裙，再配外套/鞋/包 */
export type Slot = 'outerwear' | 'top' | 'bottom' | 'dress' | 'shoes' | 'bag'
export const SLOT_ORDER: Slot[] = ['outerwear', 'top', 'dress', 'bottom', 'shoes', 'bag']

export interface RecCtx {
  date: string // YYYY-MM-DD
  weather: Weather | null | undefined
  day: DayInfo | undefined
  outfits: OutfitRecord[]
  settings: Settings
}

export interface Rec {
  slots: Partial<Record<Slot, WardrobeItem>>
  reasons: string[]
}

const DAY = 86400_000
const NEUTRAL = ['黑', '白', '米白', '米黄', '米色', '灰', '卡其', '驼色', '咖啡', '藏青', '牛仔蓝']
const LIGHT = ['白', '米白', '米黄', '米色', '浅蓝', '粉', '浅绿', '黄']
const WORK_STYLES = ['通勤', '正式']
const OFF_STYLES = ['休闲', '度假', '运动', '甜美']
// 上海各月平均最高温，天气没拿到时用
const SH_MONTH_MAX = [8, 10, 14, 20, 25, 28, 32, 32, 28, 23, 17, 11]

const label = (c: Category) => CATEGORIES.find((x) => x.key === c)?.label ?? ''

/** 可复现的随机数：同一天同一次「换一套」结果固定，不会页面一刷新就变 */
function rng(seed: string) {
  let h = 1779033703
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

export function todayHigh(ctx: RecCtx): number {
  return ctx.weather?.max ?? SH_MONTH_MAX[Number(ctx.date.slice(5, 7)) - 1]
}

export function targetSeason(ctx: RecCtx): Season {
  const hi = todayHigh(ctx)
  return hi >= 26 ? '夏' : hi <= 14 ? '冬' : '春秋'
}

export function needOuter(ctx: RecCtx): boolean {
  const hi = todayHigh(ctx)
  return hi <= 20 || (!!ctx.weather?.rainy && hi <= 24)
}

function seasonFit(item: WardrobeItem, season: Season): number | null {
  if (item.season === season) return 3
  // 不到冬天不推厚外套
  if (item.category === 'outerwear' && item.season === '冬') return null
  if (item.season === '春秋' || season === '春秋') return 0
  return null // 夏 ↔ 冬 不推
}

function recentIds(ctx: RecCtx, days: number): Set<string> {
  const now = new Date(ctx.date + 'T12:00:00').getTime()
  const ids = new Set<string>()
  for (const o of ctx.outfits) {
    const age = (now - new Date(o.date + 'T12:00:00').getTime()) / DAY
    if (age >= 0.5 && age <= days) o.itemIds.forEach((id) => ids.add(id))
  }
  return ids
}

/** 给一件衣服打分；null = 今天不适合（季节完全不对） */
function scoreOf(item: WardrobeItem, ctx: RecCtx, yesterday: Set<string>, recent: Set<string>): number | null {
  const season = targetSeason(ctx)
  let s = 0
  if (item.category !== 'bag') {
    const fit = seasonFit(item, season)
    if (fit === null) return null
    s += fit
  }
  const want = ctx.day?.off ? OFF_STYLES : WORK_STYLES
  if (item.styles.some((x) => want.includes(x))) s += 2
  const lv = wearLevel(item, ctx.settings, new Date(ctx.date + 'T12:00:00').getTime())
  s += lv === 'never' ? 3 : lv === undefined ? 2.5 : lv === 'rarely' ? 1.5 : 0
  if (yesterday.has(item.id)) s -= 6
  else if (recent.has(item.id)) s -= 2
  if (ctx.weather?.rainy && ['bottom', 'shoes', 'outerwear', 'dress'].includes(item.category)) {
    if (item.colors.some((c) => LIGHT.includes(c))) s -= 2
  }
  return s
}

export interface Ranked {
  bySlot: Record<Slot, WardrobeItem[]> // 每个位置按今天的适合度从高到低
}

/** 按今天的情况给每个位置排好序；seed 不同 → 加一点随机，「换一套」就会变 */
export function rank(items: WardrobeItem[], ctx: RecCtx, seed: number): Ranked {
  const r = rng(`${ctx.date}#${seed}`)
  const yesterday = recentIds(ctx, 1.5)
  const recent = recentIds(ctx, 3.5)
  const bySlot = Object.fromEntries(SLOT_ORDER.map((s) => [s, [] as { it: WardrobeItem; s: number }[]])) as Record<
    Slot,
    { it: WardrobeItem; s: number }[]
  >
  for (const it of items) {
    if (!(SLOT_ORDER as string[]).includes(it.category)) continue
    const s = scoreOf(it, ctx, yesterday, recent)
    if (s === null) continue
    bySlot[it.category as Slot].push({ it, s: s + r() * 3 })
  }
  return {
    bySlot: Object.fromEntries(
      SLOT_ORDER.map((k) => [k, bySlot[k].sort((a, b) => b.s - a.s).map((x) => x.it)]),
    ) as Record<Slot, WardrobeItem[]>,
  }
}

const neutral = (it?: WardrobeItem) => !it || it.colors.length === 0 || it.colors.every((c) => NEUTRAL.includes(c))

/** 从排好序的候选里拼一套；avoid = 上一套用过的衣服，尽量不重复 */
export function compose(rk: Ranked, ctx: RecCtx, seed: number, avoid: Set<string> = new Set()): Rec | null {
  const first = (slot: Slot, ok: (it: WardrobeItem) => boolean = () => true) => {
    const list = rk.bySlot[slot].filter(ok)
    return list.find((it) => !avoid.has(it.id)) ?? list[0]
  }
  const top = first('top')
  // 上衣有花色/亮色时，下装优先基础色
  const bottom = top && !neutral(top) ? (first('bottom', (b) => neutral(b)) ?? first('bottom')) : first('bottom')
  const dress = first('dress')
  const pairOk = !!(top && bottom)
  if (!pairOk && !dress) return null
  // 两种都能搭时轮流来，不用每次都穿裙子或都不穿
  const useDress = !!dress && (!pairOk || (seed + Number(ctx.date.slice(8))) % 3 === 0)
  const slots: Rec['slots'] = useDress ? { dress } : { top, bottom }
  if (needOuter(ctx)) slots.outerwear = first('outerwear')
  slots.shoes = first('shoes', (s) => !(ctx.weather?.rainy && s.colors.some((c) => LIGHT.includes(c)))) ?? first('shoes')
  slots.bag = first('bag')
  for (const k of SLOT_ORDER) if (!slots[k]) delete slots[k]
  return { slots, reasons: reasonsFor(slots, ctx) }
}

/** 单独换某一件：同一位置的下一个候选 */
export function swapSlot(rec: Rec, rk: Ranked, slot: Slot, ctx: RecCtx): Rec {
  const list = rk.bySlot[slot]
  const cur = rec.slots[slot]
  if (list.length < 2 || !cur) return rec
  const next = list[(list.findIndex((x) => x.id === cur.id) + 1) % list.length]
  const slots = { ...rec.slots, [slot]: next }
  return { slots, reasons: reasonsFor(slots, ctx) }
}

export function reasonsFor(slots: Rec['slots'], ctx: RecCtx): string[] {
  const out: string[] = []
  const all = SLOT_ORDER.map((k) => slots[k]).filter((x): x is WardrobeItem => !!x)
  const want = ctx.day?.off ? OFF_STYLES : WORK_STYLES
  if (all.some((it) => it.styles.some((s) => want.includes(s)))) out.push(ctx.day?.off ? '休闲' : '通勤')
  const hi = todayHigh(ctx)
  if (ctx.weather?.rainy) out.push(slots.outerwear ? `${label('outerwear')}挡雨` : '避开浅色防脏')
  else if (slots.outerwear) out.push(`最高 ${hi}° 加件外套`)
  else if (hi >= 28) out.push('清爽透气')
  // 最久没穿 / 从没穿过的那件
  const now = new Date(ctx.date + 'T12:00:00').getTime()
  const never = all.find((it) => !it.lastWornAt)
  const oldest = all.filter((it) => it.lastWornAt).sort((a, b) => a.lastWornAt! - b.lastWornAt!)[0]
  if (never) out.push(`${never.brand ?? ''}${label(never.category)}还没穿过`)
  else if (oldest) {
    const days = Math.floor((now - oldest.lastWornAt!) / DAY)
    if (days >= 30) out.push(`${label(oldest.category)}已 ${days >= 60 ? `${Math.floor(days / 30)} 个月` : `${days} 天`}没穿`)
  }
  return out
}

export function recIds(rec: Rec): string[] {
  return SLOT_ORDER.map((k) => rec.slots[k]?.id).filter((x): x is string => !!x)
}

/** 今天已记录的穿搭能按位置摆成一套（每个位置最多一件）就返回它，否则 null */
export function recordedRec(items: WardrobeItem[], ids: string[] | undefined, ctx: RecCtx): Rec | null {
  if (!ids?.length) return null
  const slots: Rec['slots'] = {}
  for (const id of ids) {
    const it = items.find((x) => x.id === id)
    if (!it || !(SLOT_ORDER as string[]).includes(it.category) || slots[it.category as Slot]) return null
    slots[it.category as Slot] = it
  }
  if (!slots.dress && !(slots.top && slots.bottom)) return null
  return { slots, reasons: reasonsFor(slots, ctx) }
}

/** 推不出一套时，告诉她还缺什么 */
export function missingHint(items: WardrobeItem[], ctx: RecCtx): string {
  const season = targetSeason(ctx)
  const has = (c: Category) => items.some((i) => i.category === c && seasonFit(i, season) !== null)
  if (!has('top') && !has('bottom') && !has('dress')) return `衣柜里还没有适合今天（${season}）的衣服，录几件就能推荐`
  if (!has('dress') && !has('top')) return `还缺适合今天的上衣（或连衣裙），录一件就能推荐`
  return `还缺适合今天的下装（或连衣裙），录一件就能推荐`
}
