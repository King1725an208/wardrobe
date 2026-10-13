import type { WardrobeItem } from './types'

/**
 * 照片查重：感知哈希（dHash）。
 * 把图缩到 9×8 灰度，逐行比较左右相邻像素亮度得到 64 位指纹；
 * 两张图指纹的汉明距离 ≤ DUP_THRESHOLD 判为「同一张照片」。
 * 对重压缩 / 缩放 / 轻微裁剪稳健；不试图识别「同一件衣服的不同照片」
 * （那需要 AI 逐张比对，代价高、速度慢）。
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

export function itemHash(item: WardrobeItem): Promise<string> {
  return photoHash(item.id, item.photo)
}

export interface DupGroup {
  keep: WardrobeItem // 每组的保留件：最早录入的一件
  dups: WardrobeItem[]
}

/** 全衣柜查重：按录入时间升序贪心分组，与组主指纹距离 ≤ 阈值即同组；解码失败的照片跳过 */
export async function findDuplicates(
  items: WardrobeItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<DupGroup[]> {
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt)
  const groups: { keep: WardrobeItem; hash: string; dups: WardrobeItem[] }[] = []
  let done = 0
  for (const it of sorted) {
    let h: string | null = null
    try {
      h = await itemHash(it)
    } catch {
      /* 照片解码失败（如 HEIC），跳过比对 */
    }
    done++
    onProgress?.(done, sorted.length)
    if (!h) continue
    const g = groups.find((g) => hashDistance(h, g.hash) <= DUP_THRESHOLD)
    if (g) g.dups.push(it)
    else groups.push({ keep: it, hash: h, dups: [] })
  }
  return groups.filter((g) => g.dups.length > 0).map(({ keep, dups }) => ({ keep, dups }))
}
