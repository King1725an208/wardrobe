/**
 * iPhone 相册导出格式的归一化：
 * - .livp 实况照片其实是 zip 包（静态图 + MOV 视频），抽出里面的静态图
 * - .heic/.heif 浏览器和 AI 接口都不认（base64 发过去会被 400 打回），转成 JPEG
 * - 其余格式原样返回
 * 归一化后的 Blob 浏览器能预览、方舟 AI 能识别。
 */

function isHeicName(name: string): boolean {
  return /\.hei[cf]$/i.test(name)
}

function isHeicFile(f: File): boolean {
  return isHeicName(f.name) || f.type === 'image/heic' || f.type === 'image/heif'
}

/** HEIC/HEIF → JPEG（heic2any 体积大，按需动态加载，不拖慢首屏） */
async function heicToJpeg(blob: Blob): Promise<Blob> {
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 })
  return Array.isArray(out) ? out[0] : out
}

/** .livp 实况照片：解开 zip，取最大的那张静态图（HEIC 再转 JPEG） */
async function livpToStill(file: File): Promise<Blob> {
  const { unzipSync } = await import('fflate')
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new Error('不是有效的实况照片包')
  }
  const name = Object.keys(entries)
    .filter((n) => !n.endsWith('/') && /\.(hei[cf]|jpe?g|png)$/i.test(n))
    .sort((a, b) => (entries[b]?.length ?? 0) - (entries[a]?.length ?? 0))[0]
  const data = name ? entries[name] : undefined
  if (!name || !data) throw new Error('实况照片包里没有静态图片')
  const blob = new Blob([new Uint8Array(data)], { type: isHeicName(name) ? 'image/heic' : 'image/jpeg' })
  return isHeicName(name) ? heicToJpeg(blob) : blob
}

/** 选图统一入口：返回浏览器能解码、AI 能认的 Blob；不支持的抛错由调用方提示 */
export async function normalizePhotoFile(file: File): Promise<Blob> {
  if (/\.livp$/i.test(file.name)) return livpToStill(file)
  if (isHeicFile(file)) return heicToJpeg(file)
  return file
}
