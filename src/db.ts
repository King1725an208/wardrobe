import { openDB, type IDBPDatabase } from 'idb'
import type { AddEntry, AddQueueRow, BgTask, NewItem, OutfitRecord, Settings, WardrobeItem } from './types'

let dbp: Promise<IDBPDatabase> | null = null

function db() {
  if (!dbp) {
    // v2：新增 addQueue（录入批次持久化）与 bgTasks（保存后补抠任务）；contains 守卫兼容全新安装与升级
    dbp = openDB('wardrobe', 2, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' })
        if (!d.objectStoreNames.contains('outfits')) {
          const outfits = d.createObjectStore('outfits', { keyPath: 'id' })
          outfits.createIndex('date', 'date')
        }
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' })
        if (!d.objectStoreNames.contains('addQueue')) d.createObjectStore('addQueue', { keyPath: 'key' })
        if (!d.objectStoreNames.contains('bgTasks')) d.createObjectStore('bgTasks', { keyPath: 'itemId' })
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

/** 批量写入（导入备份用）：同 id 覆盖、不同 id 新增 */
export async function bulkPutItems(items: WardrobeItem[]): Promise<void> {
  const d = await db()
  const tx = d.transaction('items', 'readwrite')
  for (const it of items) await tx.store.put(it)
  await tx.done
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

// ---------- 录入批次持久化（P2-1：切页/刷新/杀掉都不丢，重开自动续跑） ----------

export async function listAddQueue(): Promise<AddQueueRow[]> {
  const rows: AddQueueRow[] = await (await db()).getAll('addQueue')
  return rows.sort((a, b) => a.seq - b.seq)
}

/**
 * 录入批次增量落盘：patch 只给变化的条目换新对象，所以按引用 diff——
 * 只 put 引用变化的行、delete 已移除的 key，避免每次状态翻转都重写全部大 Blob。
 */
export async function syncAddQueue(prev: AddEntry[], next: AddEntry[]): Promise<void> {
  const d = await db()
  const tx = d.transaction('addQueue', 'readwrite')
  const prevByKey = new Map(prev.map((e) => [e.key, e]))
  for (const [i, e] of next.entries()) {
    if (prevByKey.get(e.key) !== e) await tx.store.put({ ...e, seq: i } as AddQueueRow)
  }
  const nextKeys = new Set(next.map((e) => e.key))
  for (const e of prev) if (!nextKeys.has(e.key)) await tx.store.delete(e.key)
  await tx.done
}

// ---------- 后台补抠任务（P2-2：先存原图，好了自动换白底图） ----------

export async function listBgTasks(): Promise<BgTask[]> {
  const rows: BgTask[] = await (await db()).getAll('bgTasks')
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

export async function putBgTask(t: BgTask): Promise<void> {
  await (await db()).put('bgTasks', t)
}

export async function deleteBgTask(itemId: string): Promise<void> {
  await (await db()).delete('bgTasks', itemId)
}
