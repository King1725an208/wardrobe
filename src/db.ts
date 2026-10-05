import { openDB, type IDBPDatabase } from 'idb'
import type { NewItem, OutfitRecord, Settings, WardrobeItem } from './types'

let dbp: Promise<IDBPDatabase> | null = null

function db() {
  if (!dbp) {
    dbp = openDB('wardrobe', 1, {
      upgrade(d) {
        d.createObjectStore('items', { keyPath: 'id' })
        const outfits = d.createObjectStore('outfits', { keyPath: 'id' })
        outfits.createIndex('date', 'date')
        d.createObjectStore('settings', { keyPath: 'key' })
      },
    })
  }
  return dbp
}

export async function listItems(): Promise<WardrobeItem[]> {
  const items = await (await db()).getAll('items')
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export async function addItem(item: NewItem): Promise<WardrobeItem> {
  const full: WardrobeItem = {
    ...item,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    wearCount: 0,
  }
  await (await db()).put('items', full)
  return full
}

export async function updateItem(item: WardrobeItem): Promise<void> {
  await (await db()).put('items', item)
}

export async function deleteItem(id: string): Promise<void> {
  await (await db()).delete('items', id)
}

export async function listOutfits(): Promise<OutfitRecord[]> {
  const all = await (await db()).getAll('outfits')
  return all.sort((a, b) => b.date.localeCompare(a.date))
}

export async function getOutfitByDate(date: string): Promise<OutfitRecord | undefined> {
  return (await db()).getFromIndex('outfits', 'date', date)
}

export async function saveOutfit(rec: OutfitRecord): Promise<void> {
  await (await db()).put('outfits', rec)
}

/** 记录某天穿了哪些衣服，更新每件衣服的 wearCount / lastWornAt */
export async function markWorn(date: string, itemIds: string[]): Promise<void> {
  const d = await db()
  const ts = new Date(date + 'T12:00:00').getTime()
  const tx = d.transaction('items', 'readwrite')
  for (const id of itemIds) {
    const item: WardrobeItem | undefined = await tx.store.get(id)
    if (!item) continue
    if (!item.lastWornAt || item.lastWornAt < ts) {
      // 同一天重复勾选只计一次：lastWornAt 是同一天则不增加
      const sameDay =
        item.lastWornAt && new Date(item.lastWornAt).toDateString() === new Date(ts).toDateString()
      if (!sameDay) item.wearCount += 1
      item.lastWornAt = ts
      await tx.store.put(item)
    }
  }
  await tx.done
}

export async function getSettings(): Promise<Settings> {
  const row = await (await db()).get('settings', 'main')
  return (row?.value as Settings) ?? {}
}

export async function saveSettings(s: Settings): Promise<void> {
  await (await db()).put('settings', { key: 'main', value: s })
}
