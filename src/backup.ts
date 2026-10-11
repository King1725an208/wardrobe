import type { WardrobeItem } from './types'

/** 备份文件里 photo 字段是 base64 data URL（Blob 不能直接进 JSON） */
type ItemJson = Omit<WardrobeItem, 'photo' | 'originalPhoto'> & {
  photo: string
  originalPhoto?: string
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob()
}

/** 导出全部衣物为 JSON 字符串（含照片 base64、穿着统计等所有字段） */
export async function exportItemsJson(items: WardrobeItem[]): Promise<string> {
  const out: ItemJson[] = []
  for (const it of items) {
    const { photo, originalPhoto, ...rest } = it
    out.push({
      ...rest,
      photo: await blobToDataUrl(photo),
      ...(originalPhoto ? { originalPhoto: await blobToDataUrl(originalPhoto) } : {}),
    })
  }
  return JSON.stringify({
    app: '电子衣柜',
    format: 'wardrobe-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: out,
  })
}

/** 解析并校验备份 JSON，照片还原为 Blob；格式不对时抛中文错误 */
export async function parseItemsJson(text: string): Promise<WardrobeItem[]> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  const rawItems = (data as { items?: unknown } | null)?.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('文件里没有衣物数据（不是电子衣柜备份？）')
  }
  const items: WardrobeItem[] = []
  for (const raw of rawItems) {
    const it = raw as Partial<ItemJson> | null
    if (
      !it ||
      typeof it.id !== 'string' ||
      typeof it.category !== 'string' ||
      typeof it.photo !== 'string' ||
      !it.photo.startsWith('data:image/')
    ) {
      throw new Error('备份数据不完整或已损坏')
    }
    const { photo, originalPhoto, ...rest } = it
    items.push({
      ...(rest as Omit<WardrobeItem, 'photo' | 'originalPhoto'>),
      colors: Array.isArray(it.colors) ? it.colors.map(String) : [],
      styles: Array.isArray(it.styles) ? it.styles.map(String) : [],
      wearCount: typeof it.wearCount === 'number' ? it.wearCount : 0,
      createdAt: typeof it.createdAt === 'number' ? it.createdAt : Date.now(),
      photo: await dataUrlToBlob(photo),
      originalPhoto:
        typeof originalPhoto === 'string' && originalPhoto.startsWith('data:image/')
          ? await dataUrlToBlob(originalPhoto)
          : undefined,
    })
  }
  return items
}
