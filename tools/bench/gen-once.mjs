// 质量 A/B 小工具：同一张图按多个输入尺寸各生成一次，存图供肉眼对比
// 用法: node tools/bench/gen-once.mjs <图片文件名包含串> <edge1,edge2,...>
//   例: node tools/bench/gen-once.mjs 134 3024,1024
// 输出: tools/bench/bench-out/img/q_<串>_e<尺寸>.jpg（bench-out 已 gitignore）
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const parent = path.resolve(root, '..')
const PIC_DIR = path.join(parent, 'Wardrobe pic')
const IMG_DIR = path.join(root, 'tools', 'bench', 'bench-out', 'img')
mkdirSync(IMG_DIR, { recursive: true })
const KEY = readFileSync(path.join(parent, 'ark-key.txt'), 'utf8').trim()
const URL_ = 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations'
const MODEL = 'doubao-seedream-5-0-pro'
const PROMPT = '去掉背景，只保留这件衣物，平铺放在纯白色背景正中'

const match = process.argv[2] ?? '134'
const edges = (process.argv[3] ?? '3024,1024').split(',').map(Number)
const file = readdirSync(PIC_DIR).find((f) => f.includes(match) && /\.(jpe?g|png|webp)$/i.test(f))
if (!file) {
  console.error('没找到图: ' + match)
  process.exit(1)
}

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.goto('about:blank')
  const b64 = readFileSync(path.join(PIC_DIR, file)).toString('base64')
  const variants = await page.evaluate(async (b64, edges) => {
    const src = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]))
    const out = {}
    for (const edge of edges) {
      const scale = edge / Math.max(src.width, src.height)
      const w = Math.round(src.width * scale)
      const h = Math.round(src.height * scale)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d').drawImage(src, 0, 0, w, h)
      const jb = await new Promise((r) => c.toBlob(r, 'image/jpeg', edge > 2000 ? 0.95 : 0.85))
      out[edge] = await new Promise((r) => {
        const fr = new FileReader()
        fr.onload = () => r(fr.result)
        fr.readAsDataURL(jb)
      })
    }
    src.close()
    return out
  }, b64, edges)

  for (const edge of edges) {
    const t0 = Date.now()
    const resp = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, prompt: PROMPT, image: variants[edge], response_format: 'b64_json', size: '1K', watermark: false }),
      signal: AbortSignal.timeout(240_000),
    })
    const j = await resp.json()
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    if (!resp.ok) {
      console.log(`e${edge}: HTTP ${resp.status} ${JSON.stringify(j).slice(0, 150)}`)
      continue
    }
    const buf = Buffer.from(j.data[0].b64_json, 'base64')
    const name = `q_${match}_e${edge}.jpg`
    writeFileSync(path.join(IMG_DIR, name), buf)
    console.log(`e${edge}: ${secs}s -> ${name} (${Math.round(buf.length / 1024)}KB) usage=${JSON.stringify(j.usage)}`)
  }
} finally {
  await browser.close()
}
