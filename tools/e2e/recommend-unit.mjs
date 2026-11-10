// 今日推荐规则单测（纯逻辑，不开浏览器）：node tools/e2e/recommend-unit.mjs
import { build } from 'rolldown'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const out = path.join(mkdtempSync(path.join(tmpdir(), 'rec-')), 'rec.mjs')
await build({ input: 'src/recommend.ts', output: { file: out, format: 'esm' }, logLevel: 'silent' })
const R = await import(out)

let fail = 0
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) fail++
}

const DAY = 86400_000
const date = '2026-11-02' // 周一
const noon = new Date(date + 'T12:00:00').getTime()
let n = 0
const it = (category, season, extra = {}) => ({
  id: `${category}-${++n}`, photo: null, category, season, colors: ['黑'], styles: [], createdAt: 0, wearCount: 0, ...extra,
})
const W = (max, rainy = false) => ({ temp: max - 3, min: max - 8, max, rainProb: rainy ? 90 : 0, text: rainy ? '小雨' : '晴', rainy })
const work = { off: false, label: '工作日', week: '周一' }
const off = { off: true, label: '周末', week: '周六' }
const ctxOf = (weather, day = work, outfits = []) => ({ date, weather, day, outfits, settings: {} })
const ids = (rec) => R.recIds(rec)
const cats = (rec) => R.SLOT_ORDER.filter((k) => rec.slots[k])

const wardrobe = [
  it('top', '春秋', { styles: ['通勤'], lastWornAt: noon - 3 * DAY, wearCount: 5 }),
  it('top', '春秋', { styles: ['休闲'] }),
  it('top', '夏', { colors: ['白'], styles: ['休闲'] }),
  it('top', '冬', { styles: ['通勤'] }),
  it('bottom', '春秋', { colors: ['白'], styles: ['通勤'] }),
  it('bottom', '春秋', { colors: ['藏青'], styles: ['通勤'] }),
  it('bottom', '夏', { colors: ['牛仔蓝'], styles: ['休闲'] }),
  it('outerwear', '春秋', { colors: ['卡其'], styles: ['通勤'], lastWornAt: noon - 150 * DAY, wearCount: 2 }),
  it('outerwear', '冬', { colors: ['黑'] }),
  it('dress', '夏', { colors: ['花色'], styles: ['度假'] }),
  it('shoes', '春秋', { colors: ['白'] }),
  it('shoes', '春秋', { colors: ['黑'] }),
  it('bag', '春秋'),
]
const get = (id) => wardrobe.find((x) => x.id === id)

// 1. 结构完整：上衣+下装 或 连衣裙
for (let seed = 0; seed < 30; seed++) {
  const c = ctxOf(W(18))
  const rec = R.compose(R.rank(wardrobe, c, seed), c, seed)
  const cs = cats(rec)
  if (!((cs.includes('top') && cs.includes('bottom')) || cs.includes('dress'))) { ok(false, '结构完整', cs.join()); break }
  if (seed === 29) ok(true, '30 个 seed 都是 上衣+下装 或 连衣裙')
}

// 2. 18° 要外套、28° 不要外套且不推冬装
{
  const c = ctxOf(W(18))
  ok(!!R.compose(R.rank(wardrobe, c, 0), c, 0).slots.outerwear, '18° 推外套')
  const h = ctxOf(W(30))
  let bad = false
  for (let s = 0; s < 20; s++) {
    const rec = R.compose(R.rank(wardrobe, h, s), h, s)
    if (rec.slots.outerwear || ids(rec).some((id) => get(id).season === '冬')) bad = true
  }
  ok(!bad, '30° 不推外套、不推冬装')
  const cold = ctxOf(W(8))
  bad = false
  for (let s = 0; s < 20; s++) if (ids(R.compose(R.rank(wardrobe, cold, s), cold, s)).some((id) => get(id).season === '夏')) bad = true
  ok(!bad, '8° 不推夏装')
}

// 2b. 保暖度：32° 时长袖毛衣(warm 3) 排在短袖T恤(warm 1) 后面；8° 时反过来
{
  const hot = [
    it('top', '夏', { subtype: 'tee_polo', styles: ['休闲'] }),
    it('top', '冬', { subtype: 'knit', styles: ['休闲'] }),
  ]
  const c = ctxOf(W(32))
  const rk = R.rank(hot, c, 0)
  ok(rk.bySlot.top[0].subtype === 'tee_polo', '32° 短袖排前（保暖度贴温）', rk.bySlot.top.map((x) => x.subtype).join(','))
  const cold = ctxOf(W(8))
  const rk2 = R.rank(hot, cold, 0)
  ok(rk2.bySlot.top[0].subtype === 'knit', '8° 长袖毛衣排前', rk2.bySlot.top.map((x) => x.subtype).join(','))
}

// 3. 下雨：鞋不推白色，22° 下雨也带外套
{
  const c = ctxOf(W(22, true))
  let white = 0
  let outer = 0
  for (let s = 0; s < 20; s++) {
    const rec = R.compose(R.rank(wardrobe, c, s), c, s)
    if (rec.slots.shoes?.colors.includes('白')) white++
    if (rec.slots.outerwear) outer++
  }
  ok(white === 0, '下雨不推白鞋')
  ok(outer === 20, '22° 下雨带外套')
  const rec = R.compose(R.rank(wardrobe, c, 0), c, 0)
  ok(rec.reasons.some((r) => r.includes('挡雨')), '理由里有「挡雨」', rec.reasons.join(' / '))
}

// 4. 不和昨天重复
{
  const yesterday = { id: 'o1', date: '2026-11-01', itemIds: wardrobe.map((x) => x.id).filter((id) => !['top-2', 'bottom-6'].includes(id) && !id.startsWith('dress')), createdAt: 0 }
  const c = ctxOf(W(18), work, [yesterday])
  let rep = 0
  for (let s = 0; s < 20; s++) {
    const rec = R.compose(R.rank(wardrobe, c, s), c, s)
    if (rec.slots.top && yesterday.itemIds.includes(rec.slots.top.id)) rep++
    if (rec.slots.bottom && yesterday.itemIds.includes(rec.slots.bottom.id)) rep++
  }
  ok(rep === 0, '上衣/下装有别的可选时不重复昨天')
}

// 5. 冷落优先：经常穿的那件通勤上衣不该总排第一
{
  const often = { ...wardrobe[0], id: 'often', lastWornAt: noon - 2 * DAY, wearCount: 20 }
  const never = { ...wardrobe[0], id: 'never', lastWornAt: undefined, wearCount: 0 }
  const c = ctxOf(W(18))
  let neverWins = 0
  for (let s = 0; s < 40; s++) if (R.rank([often, never], c, s).bySlot.top[0].id === 'never') neverWins++
  ok(neverWins >= 30, '没穿过的比经常穿的优先', `${neverWins}/40`)
}

// 6. 工作日偏通勤，周末偏休闲
{
  const a = { ...wardrobe[1], id: 'casual', styles: ['休闲'] }
  const b = { ...wardrobe[1], id: 'commute', styles: ['通勤'] }
  let w = 0
  let o = 0
  for (let s = 0; s < 40; s++) {
    if (R.rank([a, b], ctxOf(W(18), work), s).bySlot.top[0].id === 'commute') w++
    if (R.rank([a, b], ctxOf(W(18), off), s).bySlot.top[0].id === 'casual') o++
  }
  ok(w >= 28 && o >= 28, '工作日通勤 / 周末休闲优先', `工作日 ${w}/40，周末 ${o}/40`)
}

// 7. 换一套：结果会变
{
  const c = ctxOf(W(18))
  const a = R.compose(R.rank(wardrobe, c, 0), c, 0)
  const b = R.compose(R.rank(wardrobe, c, 1), c, 1, new Set(ids(a)))
  ok(ids(a).join() !== ids(b).join(), '换一套后不一样', `${ids(a).join()} → ${ids(b).join()}`)
}

// 8. 单独换一件：只换那个位置
{
  const c = ctxOf(W(18))
  const rk = R.rank(wardrobe, c, 0)
  const a = R.compose(rk, c, 0)
  const slot = a.slots.top ? 'top' : 'dress'
  const b = R.swapSlot(a, rk, 'shoes', c)
  ok(b.slots.shoes.id !== a.slots.shoes.id && b.slots[slot].id === a.slots[slot].id, '点鞋只换鞋')
}

// 9. 衣服不够：返回 null + 提示
{
  const c = ctxOf(W(18))
  const only = [it('top', '春秋')]
  ok(R.compose(R.rank(only, c, 0), c, 0) === null, '只有上衣时推不出')
  ok(R.missingHint(only, c).includes('下装'), '提示缺下装', R.missingHint(only, c))
  ok(R.missingHint([], c).includes('录几件'), '空衣柜提示', R.missingHint([], c))
}

// 10. 天气没拿到：按月份估温度照样能推
{
  const c = ctxOf(null)
  ok(!!R.compose(R.rank(wardrobe, c, 0), c, 0), '天气没拿到也能推')
}

console.log(fail ? `❌ ${fail} 项失败` : '✅ 推荐规则单测全部通过')
process.exit(fail ? 1 : 0)
