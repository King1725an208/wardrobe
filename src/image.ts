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
