/**
 * HEIC 码流探针（本地调试用）：不解码，直接解析 box 结构回答
 * 「这个 HEIC 到底是什么编码」——HEVC profile、位深、分辨率、品牌。
 * 支持 .heic 直传或 .livp（自动解 zip 取最大的静态图）。
 *
 * 用法：node tools/e2e/probe-heic.mjs <文件路径>
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'

const file = process.argv[2]
if (!file) {
  console.error('用法: node tools/e2e/probe-heic.mjs <.heic|.livp 文件路径>')
  process.exit(1)
}

let buf = new Uint8Array(readFileSync(file))
// .livp 是 zip：解开取最大的图片条目
if (buf[0] === 0x50 && buf[1] === 0x4b) {
  const entries = unzipSync(buf)
  const names = Object.keys(entries)
  const images = names
    .filter((n) => /\.(hei[cf]|jpe?g|png)$/i.test(n))
    .sort((a, b) => entries[b].length - entries[a].length)
  const name = images[0] ?? names.sort((a, b) => entries[b].length - entries[a].length)[0]
  console.log(`zip 内条目: ${names.join(', ')}`)
  console.log(`取静态图: ${name} (${entries[name].length}B)`)
  buf = entries[name]
}

const ascii = (off, len) => String.fromCharCode(...buf.subarray(off, off + len))
const u32 = (off) => (buf[off] << 24 | buf[off + 1] << 16 | buf[off + 2] << 8 | buf[off + 3]) >>> 0

function findBytes(needle, from = 0) {
  const hits = []
  for (let i = from; i + needle.length <= buf.length && hits.length < 8; i++) {
    let ok = true
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle.charCodeAt(j)) { ok = false; break }
    if (ok) hits.push(i)
  }
  return hits
}

// ftyp：主品牌 + 兼容品牌
const ftyp = findBytes('ftyp')[0]
if (ftyp != null) {
  const size = u32(ftyp - 4)
  const brands = []
  for (let o = ftyp + 4; o < ftyp - 4 + size; o += 4) brands.push(ascii(o, 4))
  console.log(`ftyp 品牌: ${brands.join(' ')}`)
}

// hvcC：HEVC 解码配置（profile / 位深 / level）
const hvcC = findBytes('hvcC')[0]
if (hvcC != null) {
  const r = hvcC + 4 // 记录起点
  const profileIdc = buf[r + 1] & 0x1f
  const level = buf[r + 12]
  const bitDepthLuma = (buf[r + 17] & 0x07) + 8
  const bitDepthChroma = (buf[r + 18] & 0x07) + 8
  const profiles = { 1: 'Main', 2: 'Main 10', 3: 'Main Still Picture', 4: 'Rext' }
  console.log(`HEVC profile: ${profiles[profileIdc] ?? `未知(${profileIdc})`}, level ${(level / 30).toFixed(1)}, 位深 luma=${bitDepthLuma}-bit chroma=${bitDepthChroma}-bit`)
} else {
  console.log('没找到 hvcC——不是 HEVC 编码？')
}

// ispe：图像尺寸
for (const ispe of findBytes('ispe')) {
  const w = u32(ispe + 8)
  const h = u32(ispe + 12)
  if (w > 0 && w < 20000 && h > 0 && h < 20000) console.log(`ispe 尺寸: ${w}x${h}`)
}

// colr / hvcC 之外看看有没有 10-bit HDR 标记（pasp/clli/mdcv 等）
for (const tag of ['mdcv', 'clli', 'cLLi', 'nclx', 'ipma']) {
  const hits = findBytes(tag)
  if (hits.length) console.log(`含 ${tag} box ×${hits.length}`)
}
console.log('文件大小:', buf.length, 'B', `(${path.basename(file)})`)
