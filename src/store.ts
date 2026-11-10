import { create } from 'zustand'
import * as db from './db'
import { enqueueAiTask, enqueueBgTask, holdBgTask, onAiTaskSettled, onBgTaskSettled, releaseBgTask, resumeBgTasks } from './bgtasks'
import type { AddEntry, NewItem, OutfitRecord, Settings, WardrobeItem } from './types'

interface State {
  items: WardrobeItem[]
  outfits: OutfitRecord[]
  settings: Settings
  loaded: boolean
  addEntries: AddEntry[]
  addCur: number
  bgPending: string[] // 有后台补抠任务在跑/排队的衣物 id（卡片显示「抠图中」）
  aiPending: string[] // 有后台识图任务在跑/排队的衣物 id（卡片显示「识图中」）
  setAddCur: (i: number) => void
  setAddEntries: (u: AddEntry[] | ((l: AddEntry[]) => AddEntry[])) => void
  load: () => Promise<void>
  add: (item: NewItem) => Promise<WardrobeItem>
  update: (item: WardrobeItem) => Promise<void>
  remove: (id: string) => Promise<void>
  saveOutfit: (rec: OutfitRecord) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  /** 后台补抠成功/在飞抠图交接：主图换成白底图（原图存 originalPhoto） */
  completeBg: (itemId: string, cutout: Blob) => Promise<void>
  /** 保存时抠图已失败 → 落一条后台补抠任务（P2-2） */
  enqueueBg: (itemId: string, photo: Blob) => Promise<void>
  /** 保存时抠图还在飞：落占位任务，杀掉 App 后重开也能补上白底图 */
  holdBg: (itemId: string, photo: Blob) => Promise<void>
  /** 衣柜页识图：把一件衣服的 AI 识别排进后台队列；mode=fill 只填空字段，overwrite 覆盖已有识别字段 */
  enqueueAi: (itemId: string, mode?: 'fill' | 'overwrite') => Promise<void>
  /** 在飞抠图回来了：cutout 有图就换主图（null = 原图已是白底），然后清掉占位任务 */
  settleHandoff: (itemId: string, cutout: Blob | null) => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  items: [],
  outfits: [],
  settings: {},
  loaded: false,
  addEntries: [],
  addCur: 0,
  bgPending: [],
  aiPending: [],
  setAddCur: (i) => set({ addCur: i }),
  setAddEntries: (u) => {
    const prev = get().addEntries
    const next = typeof u === 'function' ? u(prev) : u
    set({ addEntries: next })
    // 批次落盘（fire-and-forget）：切页/刷新/杀掉 App 都不丢，重开从 IDB 恢复
    void db.syncAddQueue(prev, next).catch((e) => console.warn('录入队列落盘失败：', e))
  },
  load: async () => {
    const [items, outfits, settings, queueRows, bgTasks] = await Promise.all([
      db.listItems(),
      db.listOutfits(),
      db.getSettings(),
      db.listAddQueue(),
      db.listBgTasks(),
    ])
    // 被杀/刷新时正在跑的条目（loading）不可能是完成态，重置回 idle；回到录入页自动补跑
    const addEntries = queueRows.map(({ seq: _seq, ...e }) => ({
      ...e,
      ai: e.ai === 'loading' ? ('idle' as const) : e.ai,
      bg: e.bg === 'loading' ? ('idle' as const) : e.bg,
    }))
    set({
      items,
      outfits,
      settings,
      addEntries,
      bgPending: bgTasks.filter((t) => t.kind !== 'ai').map((t) => t.itemId),
      aiPending: bgTasks.filter((t) => t.kind === 'ai').map((t) => t.itemId),
      loaded: true,
    })
    void resumeBgTasks(settings) // 后台补抠任务续跑
  },
  add: async (item) => {
    const full = await db.addItem(item)
    set({ items: [full, ...get().items] })
    return full
  },
  update: async (item) => {
    await db.updateItem(item)
    set({ items: get().items.map((i) => (i.id === item.id ? item : i)) })
  },
  remove: async (id) => {
    await db.deleteItem(id)
    set({ items: get().items.filter((i) => i.id !== id) })
  },
  saveOutfit: async (rec) => {
    await db.saveOutfit(rec)
    const outfits = get().outfits.filter((o) => o.id !== rec.id)
    set({ outfits: [rec, ...outfits].sort((a, b) => b.date.localeCompare(a.date)) })
  },
  saveSettings: async (patch) => {
    const s = { ...get().settings, ...patch }
    if (s.theme) localStorage.setItem('theme', s.theme)
    set({ settings: s })
    await db.saveSettings(s)
  },
  completeBg: async (itemId, cutout) => {
    const it = get().items.find((i) => i.id === itemId)
    if (it) await get().update({ ...it, photo: cutout, originalPhoto: it.originalPhoto ?? it.photo })
    set({ bgPending: get().bgPending.filter((id) => id !== itemId) })
  },
  enqueueBg: async (itemId, photo) => {
    const s = get().settings
    if (!s.doubaoApiKey || s.removeBg === false) return // 没 key 或用户关了去背景：不补
    if (!get().bgPending.includes(itemId)) set({ bgPending: [...get().bgPending, itemId] })
    await enqueueBgTask(itemId, photo, s)
  },
  holdBg: async (itemId, photo) => {
    if (!get().bgPending.includes(itemId)) set({ bgPending: [...get().bgPending, itemId] })
    await holdBgTask(itemId, photo, get().settings)
  },
  settleHandoff: async (itemId, cutout) => {
    if (cutout) await get().completeBg(itemId, cutout)
    else set({ bgPending: get().bgPending.filter((id) => id !== itemId) })
    await releaseBgTask(itemId)
  },
  enqueueAi: async (itemId, mode = 'fill') => {
    const s = get().settings
    if (!s.doubaoApiKey) return // 没 key 不入队（UI 层会先提示）
    // 补抠任务和识图任务共用 bgTasks（keyPath=itemId），同件只允许一种在飞，避免互相覆盖
    if (get().bgPending.includes(itemId) || get().aiPending.includes(itemId)) return
    set({ aiPending: [...get().aiPending, itemId] })
    await enqueueAiTask(itemId, s, mode)
  },
}))

// 后台补抠任务落定：成功换主图（原图存 originalPhoto）；最终落定（含放弃/白底跳过）摘掉「抠图中」
onBgTaskSettled((itemId, cutout, _err, final) => {
  const s = useStore.getState()
  if (cutout) void s.completeBg(itemId, cutout)
  else if (final) useStore.setState({ bgPending: s.bgPending.filter((id) => id !== itemId) })
})

// 后台识图任务落定：fill 模式只补空字段（颜色/风格/材质/品牌），已有内容和分类/季节一律不动；
// overwrite 模式（「重新识图」）用 AI 结果覆盖分类/季节/颜色/风格/材质/品牌（只覆盖 AI 给出了值的字段，
// 价格/备注/尺码等手填内容不受影响）；最终落定（含失败放弃）摘掉「识图中」
onAiTaskSettled((itemId, guess, _err, final, mode) => {
  const s = useStore.getState()
  if (guess) {
    const it = s.items.find((i) => i.id === itemId)
    if (it) {
      const patch: Partial<WardrobeItem> = mode === 'overwrite'
        ? {
            ...(guess.category ? { category: guess.category } : {}),
            ...(guess.season ? { season: guess.season } : {}),
            ...(guess.colors?.length ? { colors: guess.colors } : {}),
            ...(guess.styles?.length ? { styles: guess.styles } : {}),
            ...(guess.material ? { material: guess.material } : {}),
            ...(guess.brand ? { brand: guess.brand } : {}),
          }
        : {
            colors: it.colors.length ? it.colors : guess.colors ?? [],
            styles: it.styles.length ? it.styles : guess.styles ?? [],
            material: it.material ?? guess.material,
            brand: it.brand ?? guess.brand,
          }
      void s.update({ ...it, ...patch })
    }
  }
  if (final) useStore.setState({ aiPending: useStore.getState().aiPending.filter((id) => id !== itemId) })
})
