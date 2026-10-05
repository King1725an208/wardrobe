import * as db from './db'
import type { NewItem } from './types'

const DAY = 24 * 3600 * 1000

interface DemoSpec {
  file: string
  item: Omit<NewItem, 'photo'>
  wearCount: number
  lastWornDaysAgo?: number
}

const DEMO: DemoSpec[] = [
  {
    file: 'tshirt.jpg',
    item: { category: 'top', brand: '优衣库', price: 99, colors: ['白'], styles: ['休闲'], season: '夏' },
    wearCount: 5,
    lastWornDaysAgo: 3,
  },
  {
    file: 'jeans.jpg',
    item: { category: 'bottom', brand: 'UR', price: 259, colors: ['浅蓝'], styles: ['休闲', '通勤'], season: '春秋' },
    wearCount: 4,
    lastWornDaysAgo: 8,
  },
  {
    file: 'cardigan.jpg',
    item: { category: 'outerwear', price: 329, colors: ['米色'], styles: ['通勤', '甜美'], season: '春秋', material: '针织' },
    wearCount: 1,
    lastWornDaysAgo: 60,
  },
  {
    file: 'dress.jpg',
    item: { category: 'dress', price: 459, colors: ['碎花'], styles: ['甜美', '度假'], season: '夏' },
    wearCount: 0,
  },
  {
    file: 'sneakers.jpg',
    item: { category: 'shoes', price: 569, colors: ['白'], styles: ['休闲', '运动'], season: '春秋' },
    wearCount: 6,
    lastWornDaysAgo: 1,
  },
]

function dateStr(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10)
}

/** 导入示例数据：5 件衣服 + 3 条历史穿搭记录。返回新增件数。 */
export async function importDemoData(): Promise<number> {
  const existing = await db.listItems()
  if (existing.some((i) => i.note === 'demo')) {
    // 已导入过：给旧示例穿搭补齐 开衫+鞋，方便看拆解图
    const idOf = (n: number) => existing.find((i) => i.note === 'demo' && i.brand === ['优衣库', 'UR', 'UR', 'UR', '优衣库'][n] && i.category === ['top', 'bottom', 'outerwear', 'dress', 'shoes'][n])?.id
    const outfits = await db.listOutfits()
    for (const o of outfits) {
      const extra = [idOf(2), idOf(4)].filter((x): x is string => !!x && !o.itemIds.includes(x))
      if (extra.length && o.itemIds.some((id) => existing.find((i) => i.id === id)?.note === 'demo')) {
        await db.saveOutfit({ ...o, itemIds: [...o.itemIds, ...extra] })
      }
    }
    return 0
  }

  const created: { id: string; wearDaysAgo: number[] }[] = []
  for (const d of DEMO) {
    const photo = await (await fetch(`/demo/${d.file}`)).blob()
    const item = await db.addItem({ ...d.item, photo, note: 'demo' })
    item.wearCount = d.wearCount
    if (d.lastWornDaysAgo != null) item.lastWornAt = Date.now() - d.lastWornDaysAgo * DAY
    await db.updateItem(item)
    created.push({ id: item.id, wearDaysAgo: d.lastWornDaysAgo != null ? [d.lastWornDaysAgo] : [] })
  }

  // 三天历史穿搭记录（白T+牛仔 / 开衫+牛仔 / 白T+牛仔+鞋+开衫）
  const outfits: { daysAgo: number; idx: number[] }[] = [
    { daysAgo: 8, idx: [0, 1, 4] },
    { daysAgo: 4, idx: [2, 1, 4] },
    { daysAgo: 1, idx: [0, 4, 2, 1] },
  ]
  for (const o of outfits) {
    await db.saveOutfit({
      id: crypto.randomUUID(),
      date: dateStr(o.daysAgo),
      itemIds: o.idx.map((i) => created[i].id),
      createdAt: Date.now() - o.daysAgo * DAY,
    })
  }
  return DEMO.length
}
