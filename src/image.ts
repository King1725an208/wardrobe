/**
 * 判断图片是否已经是「白底 / 透明底」（电商商品图、已抠过的图）。
 * 录入时若是则跳过 Seedream 去背景，省时间也省调用费。
 *
 * 判定：把图缩到 64×64 采样——
 * ① 透明像素占比 > 15% → PNG 透明底（已抠图）
 * ② 四条边的不透明像素 ≥ 90% 接近纯白 → 白底商品图
 * 检测失败按「不是白底」处理（照常去背景，宁可多处理不可漏处理）。
 */
export async function hasPlainBackground(blob: Blob): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(blob)
    const S = 64
    const cv = document.createElement('canvas')
    cv.width = S
    cv.height = S
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.drawImage(bmp, 0, 0, S, S)
    bmp.close()
    const { data } = ctx.getImageData(0, 0, S, S)
    let transparent = 0
    let edgeWhite = 0
    let edgeTotal = 0
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4
        if (data[i + 3] < 16) {
          transparent++
          continue
        }
        if (x === 0 || y === 0 || x === S - 1 || y === S - 1) {
          edgeTotal++
          if (data[i] > 242 && data[i + 1] > 242 && data[i + 2] > 242) edgeWhite++
        }
      }
    }
    if (transparent / (S * S) > 0.15) return true
    if (edgeTotal > 0 && edgeWhite / edgeTotal >= 0.9) return true
    return false
  } catch {
    return false
  }
}

/**
 * 去背景结果统一画幅：裁掉四周近白/透明留白，衣服居中、等比缩放到统一画布。
 *
 * Seedream 每次生成的衣服占比/位置/留白都不一样，卡片正方形裁切后显示大小不一；
 * 这里在本地确定性处理（不花 token），保证所有衣服在格子里大小一致。
 * 白色衣物靠褶皱/阴影像素撑开边界；实在识别不出内容时返回原图，不阻塞流程。
 */
export async function normalizeCutout(blob: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob)
    const w = bmp.width
    const h = bmp.height
    if (!w || !h) {
      bmp.close()
      return blob
    }
    // 采样画布上限 1024：卡片也就这么大，再大没意义，还省存储
    const scale = Math.min(1, 1024 / Math.max(w, h))
    const sw = Math.max(1, Math.round(w * scale))
    const sh = Math.max(1, Math.round(h * scale))
    const cv = document.createElement('canvas')
    cv.width = sw
    cv.height = sh
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      bmp.close()
      return blob
    }
    ctx.drawImage(bmp, 0, 0, sw, sh)
    bmp.close()
    const { data } = ctx.getImageData(0, 0, sw, sh)

    // 衣服实际占的区域 = 非（近白 或 透明）的像素的包围盒
    let minX = sw
    let minY = sh
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4
        const a = data[i + 3]
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const isBg = a < 24 || (r > 246 && g > 246 && b > 246)
        if (isBg) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxX < 0) return blob // 全是背景（异常），返回原图
    const rawW = maxX - minX + 1
    const rawH = maxY - minY + 1
    if (rawW * rawH < sw * sh * 0.03) return blob // 内容过小（可能是纯白衣物识别失败），返回原图

    // 四周留白边距：取内容尺寸的 6%，让呼吸感一致
    const m = Math.round(Math.max(rawW, rawH) * 0.06)
    const cx0 = Math.max(0, minX - m)
    const cy0 = Math.max(0, minY - m)
    const cx1 = Math.min(sw - 1, maxX + m)
    const cy1 = Math.min(sh - 1, maxY + m)
    const cw = cx1 - cx0 + 1
    const ch = cy1 - cy0 + 1

    // 目标：内容最长边占画布 84%，居中，四周留白一致 → 所有衣服显示大小统一
    const OUT = 1024
    const k = (OUT * 0.84) / Math.max(cw, ch)
    const dw = Math.max(1, Math.round(cw * k))
    const dh = Math.max(1, Math.round(ch * k))
    const out = document.createElement('canvas')
    out.width = OUT
    out.height = OUT
    const octx = out.getContext('2d')
    if (!octx) return blob
    octx.fillStyle = '#fff'
    octx.fillRect(0, 0, OUT, OUT)
    octx.imageSmoothingQuality = 'high'
    octx.drawImage(cv, cx0, cy0, cw, ch, (OUT - dw) / 2, (OUT - dh) / 2, dw, dh)
    return await new Promise<Blob>((res, rej) =>
      out.toBlob((b) => (b ? res(b) : rej(new Error('toBlob 失败'))), 'image/jpeg', 0.9),
    )
  } catch {
    return blob // 归一化失败不阻塞，返回原图
  }
}
