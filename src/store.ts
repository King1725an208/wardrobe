import { create } from 'zustand'
import * as db from './db'
import type { NewItem, OutfitRecord, Settings, WardrobeItem } from './types'

interface State {
  items: WardrobeItem[]
  outfits: OutfitRecord[]
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  add: (item: NewItem) => Promise<WardrobeItem>
  update: (item: WardrobeItem) => Promise<void>
  remove: (id: string) => Promise<void>
  saveOutfit: (rec: OutfitRecord) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  items: [],
  outfits: [],
  settings: {},
  loaded: false,
  load: async () => {
    const [items, outfits, settings] = await Promise.all([
      db.listItems(),
      db.listOutfits(),
      db.getSettings(),
    ])
    set({ items, outfits, settings, loaded: true })
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
}))
