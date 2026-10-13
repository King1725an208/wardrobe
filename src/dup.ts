import type { WardrobeItem } from './types'

/**
 * 照片查重：感知哈希（dHash）。
 * 把图缩到 9×8 灰度，逐行比较左右相邻像素亮度得到 64 位指纹；
 * 两张图指纹的汉明距离 ≤ DUP_THRESHOLD 判为「同一张照片」。
 * 对重压缩 / 缩放 / 轻微裁剪稳健；不试图识别「同一件衣服的不同照片」
 * （那需要 AI 逐张比对，代价高、速度慢）。
 *
 * 关键：每件衣服可能存了两张图——主图 photo（可能是 AI 去背景后重绘的
 * 白底图，和原图的像素、构图差很多）与原图 originalPhoto。只比主图会漏掉
 * 「一件存了白底图、一件存了原图」的同源照片，所以每件取全部指纹，
 * 任意一对距离 ≤ 阈值即判重复。
 */

export const DUP_THRESHOLD = 8

/** 计算照片的 64 位感知指纹（16 个十六进制字符） */
export async function imageHash(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob)
  const W = 9
  const H = 8
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 不可用')
  ctx.drawImage(bmp, 0, 0, W, H)
  bmp.close()
  const { data } = ctx.getImageData(0, 0, W, H)
  const gray = (x: number, y: number) => {
    const i = (y * W + x) * 4
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
  }
  let bits = 0n
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      bits = (bits << 1n) | (gray(x, y) > gray(x + 1, y) ? 1n : 0n)
    }
  }
  return bits.toString(16).padStart(16, '0')
}

/** 两个指纹的汉明距离（0 = 完全一致） */
export function hashDistance(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let d = 0
  while (x > 0n) {
    d += Number(x & 1n)
    x >>= 1n
  }
  return d
}

// 指纹缓存：key 用衣服 id / 录入条目 key；Blob 引用变了说明照片换了，自动重算
const cache = new Map<string, { photo: Blob; hash: string }>()

/** 带缓存的照片指纹（照片不变就只算一次） */
export async function photoHash(key: string, photo: Blob): Promise<string> {
  const c = cache.get(key)
  if (c && c.photo === photo) return c.hash
  const hash = await imageHash(photo)
  cache.set(key, { photo, hash })
  return hash
}

/**
 * 一件衣服的全部照片指纹：主图 + 原图（如有）。
 * 单张解码失败（如 HEIC）只跳过该张；都失败则返回空数组（不参与比对）。
 */
export async function itemHashes(item: WardrobeItem): Promise<string[]> {
  const hs: string[] = []
  try {
    hs.push(await photoHash(item.id, item.photo))
  } catch {
    /* 主图解码失败，跳过这张 */
  }
  if (item.originalPhoto) {
    try {
      hs.push(await photoHash(item.id + '#orig', item.originalPhoto))
    } catch {
      /* 原图解码失败，跳过这张 */
    }
  }
  return hs
}

/** 两组指纹两两比对的最小汉明距离（任一空组返回 Infinity） */
export function minHashDistance(a: string[], b: string[]): number {
  let min = Infinity
  for (const x of a) for (const y of b) min = Math.min(min, hashDistance(x, y))
  return min
}

export interface DupGroup {
  keep: WardrobeItem // 每组的保留件：最早录入的一件
  dups: WardrobeItem[]
}

/**
 * 全衣柜查重：按录入时间升序贪心分组——每件的全部指纹（主图+原图）与
 * 组内已有指纹任一对距离 ≤ 阈值即同组；每组最早录入的一件为保留件。
 */
export async function findDuplicates(
  items: WardrobeItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<DupGroup[]> {
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt)
  const hashed: { it: WardrobeItem; hs: string[] }[] = []
  let done = 0
  for (const it of sorted) {
    const hs = await itemHashes(it)
    done++
    onProgress?.(done, sorted.length)
    if (hs.length) hashed.push({ it, hs })
  }
  const groups: { keep: WardrobeItem; hs: string[]; dups: WardrobeItem[] }[] = []
  for (const { it, hs } of hashed) {
    const g = groups.find((g) => minHashDistance(hs, g.hs) <= DUP_THRESHOLD)
    if (g) {
      g.dups.push(it)
      g.hs.push(...hs) // 组内指纹取并集：后续件可与组中任意一件的任意一张图比对
    } else {
      groups.push({ keep: it, hs: [...hs], dups: [] })
    }
  }
  // 诊断：控制台输出全衣柜最小照片距离，排查「明明一样却没查出」时用
  let min = Infinity
  let minPair: [string, string] | null = null
  for (let i = 0; i < hashed.length; i++) {
    for (let j = i + 1; j < hashed.length; j++) {
      const d = minHashDistance(hashed[i].hs, hashed[j].hs)
      if (d < min) {
        min = d
        minPair = [hashed[i].it.id, hashed[j].it.id]
      }
    }
  }
  if (minPair) console.debug(`[查重] 最小照片距离 ${min}（阈值 ${DUP_THRESHOLD}）`, minPair)
  return groups.filter((g) => g.dups.length > 0).map(({ keep, dups }) => ({ keep, dups }))
}
