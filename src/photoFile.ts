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

function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  // libheif 等 WASM 库抛的是普通对象（{code, message}），String() 只会得到 [object Object]
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    if (typeof o.message === 'string') return o.code != null ? `${o.message}（code ${o.code}）` : o.message
    try {
      return JSON.stringify(e)
    } catch {
      /* 循环引用则落到 String */
    }
  }
  return String(e)
}

/**
 * HEIC/HEIF → JPEG：libheif 官方 WASM（libheif-js，1.23.x），按需动态加载不拖慢首屏。
 * heic2any 内置的 libheif 1.10 太老，解不了小米等机型计算摄影的多图 HEIC
 * （报 ERR_LIBHEIF format not supported）。
 * 这类 HEIC 常含多张图（20MP+ 主图 + 若干衍生图）：衣柜预览和 AI 识别用不上超大图，
 * 优先选长边 ≤3200px 的最大那张，少解几倍像素，快很多。
 */
type LibHeif = import('libheif-js/libheif-wasm/libheif-bundle.mjs').LibHeifModule
let libheifP: Promise<LibHeif> | undefined
/** emscripten MODULARIZE 工厂：浏览器里 wasm 只能异步编译；模块全局只初始化一次 */
function loadLibheif(): Promise<LibHeif> {
  if (!libheifP) {
    libheifP = import('libheif-js/libheif-wasm/libheif-bundle.mjs').then(async (m) => m.default())
  }
  return libheifP
}

async function heicToJpeg(blob: Blob): Promise<Blob> {
  console.log('[照片] 加载 libheif wasm...')
  const libheif = await loadLibheif()
  console.log('[照片] libheif 就绪，读文件...')
  const data = new Uint8Array(await blob.arrayBuffer())
  let images
  try {
    images = new libheif.HeifDecoder().decode(data)
  } catch (e) {
    throw new Error(`HEIC 解码失败（${errText(e)}）`)
  }
  console.log('[照片] 容器解析完，', images.length, '张图')
  const bySize = [...images].sort((a, b) => b.get_width() * b.get_height() - a.get_width() * a.get_height())
  const img = bySize.find((i) => Math.max(i.get_width(), i.get_height()) <= 3200) ?? bySize[0]
  if (!img) throw new Error('HEIC 解码失败（文件里没有图像）')
  const w = img.get_width()
  const h = img.get_height()
  console.log(`[照片] HEIC 含 ${images.length} 张图，解码 ${w}x${h}`)
  const imageData = new ImageData(w, h)
  console.log('[照片] 开始解码像素...')
  try {
    await new Promise<void>((resolve, reject) => {
      img.display(imageData, (out) => (out ? resolve() : reject(new Error('像素解包失败'))))
    })
  } catch (e) {
    throw new Error(`HEIC 解码失败（${errText(e)}）`)
  }
  // 解出来可能是 20MP+ 的巨图（小米计算摄影），衣柜卡片和 AI 识别都用不上：
  // 不降采样的话，巨图 canvas 的 putImageData/toBlob 在低端设备上会卡死甚至 OOM。
  // createImageBitmap 带 resize 一步完成缩放，不用先画巨图画布。
  const scale = Math.min(1, 2048 / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('HEIC 解码失败（canvas 不可用）')
  if (scale >= 1) {
    ctx.putImageData(imageData, 0, 0)
  } else {
    console.log(`[照片] 降采样 ${w}x${h} -> ${tw}x${th}`)
    const bmp = await createImageBitmap(imageData, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' })
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
  }
  console.log('[照片] 转 JPEG...')
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
  if (!jpeg) throw new Error('HEIC 解码失败（JPEG 编码失败）')
  console.log(`[照片] 完成，JPEG ${(jpeg.size / 1024).toFixed(0)}KB`)
  return jpeg
}

/** .livp 实况照片：解开 zip，取最大的那张静态图（HEIC 再转 JPEG） */
async function livpToStill(file: File): Promise<Blob> {
  const { unzipSync } = await import('fflate')
  const buf = new Uint8Array(await file.arrayBuffer())
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(buf)
  } catch {
    // 有些导出工具产的 .livp 其实是单个文件改了后缀，按内容魔数兜底
    const head = String.fromCharCode(...buf.subarray(0, 16))
    if (buf[0] === 0xff && buf[1] === 0xd8) return new Blob([buf], { type: 'image/jpeg' })
    if (head.slice(4, 8) === 'ftyp') {
      if (/^(hei|mif1|msf1)/.test(head.slice(8, 12))) return heicToJpeg(new Blob([buf], { type: 'image/heic' }))
      throw new Error('这个 .livp 不是照片包，而是视频文件，请改用其中的静态照片')
    }
    throw new Error('实况照片包解压失败（不是有效的 zip）')
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
