/**
 * .livp / .heic 上传的端到端测试（真实 Chrome，无头模式）
 *
 * 做什么：
 * 1. 用真实 HEIC 样本拼一个接近 iPhone 导出的 .livp（HEIC 静态图 + MOV 视频，
 *    且 MOV 比 HEIC 大，模拟真实实况照片）；
 * 2. 本地起静态服务器伺服 dist/（保持 /wardrobe/ 子路径，和 GitHub Pages 一致）；
 * 3. 驱动本机 Chrome 打开应用 → ＋录入 → 从相册多选 [.livp, .heic, .png]；
 * 4. 断言：不弹「读不出来」、3 张缩略图出现、每张预览浏览器都能解码、
 *    .livp 和 .heic 归一化后是 image/jpeg（AI 接口才不会 400）。
 *
 * 用法：npm run test:e2e（自动先 build）；CHROME_PATH 环境变量可指定浏览器路径。
 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dist = path.join(root, 'dist')
const fixtures = path.join(root, 'tools', 'e2e', 'fixtures')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- 1. 造测试文件 ----------
const work = path.join(tmpdir(), 'wardrobe-e2e')
await mkdir(work, { recursive: true })

const heicStill = await readFile(path.join(fixtures, 'iphone-still.heic'))
// MOV 用随机字节即可（归一化应当忽略它），特意做得比 HEIC 大，模拟真实 .livp
const mov = randomBytes(2 * 1024 * 1024)
const livp = zipSync({
  'IMG_0001.HEIC': [new Uint8Array(heicStill), { level: 0 }],
  'IMG_0001.MOV': [mov, { level: 0 }],
})
const livpPath = path.join(work, '2026-09-27 161608.livp') // 带空格，模拟真实导出文件名
await writeFile(livpPath, livp)

const heicPath = path.join(fixtures, 'direct.heic')
// 「假 livp」：某些导出工具直接把 HEIC 改后缀，归一化应嗅探魔数兜底
const fakeLivpPath = path.join(work, 'renamed-fake.livp')
await writeFile(fakeLivpPath, await readFile(heicPath))
// 1x1 PNG，验证普通格式不受影响的基线
const pngPath = path.join(work, 'plain.png')
await writeFile(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
console.log(`测试文件: ${livpPath} (${livp.length}B), direct.heic, plain.png`)

// ---------- 2. 静态服务器（模拟 GitHub Pages 子路径） ----------
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (!p.startsWith('/wardrobe/')) {
    res.writeHead(404)
    return res.end('not found')
  }
  const rel = p.slice('/wardrobe/'.length) || 'index.html'
  let file = path.join(dist, rel)
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html') // SPA 兜底
  }
  const body = await readFile(file)
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  res.end(body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
console.log(`本地伺服: http://127.0.0.1:${port}/wardrobe/`)


// ---------- 3. 驱动真实 Chrome ----------
const chromePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find((p) => existsSync(p))
if (!chromePath) {
  console.error('找不到 Chrome/Edge，请设 CHROME_PATH')
  process.exit(1)
}

let failed = false
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  const dialogs = []
  let dialogHit = null
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    dialogHit?.(d.message())
    d.dismiss().catch(() => {})
  })
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [页面 ${m.type()}]`, m.text())
  })
  page.on('pageerror', (e) => console.log('  [页面异常]', e.message))

  await page.goto(`http://127.0.0.1:${port}/wardrobe/`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForSelector('nav.tabbar', { timeout: 15000 })
  // 进「＋录入」
  await page.evaluate(() => [...document.querySelectorAll('nav.tabbar button')].find((b) => b.textContent.includes('录入'))?.click())
  const input = await page.waitForSelector('input[type="file"][multiple]', { timeout: 10000 })

  // 多选上传：livp + heic + png（和用户操作路径完全一致）
  const dialogP = new Promise((r) => (dialogHit = r))
  await input.uploadFile(livpPath, fakeLivpPath, heicPath, pngPath)
  await Promise.race([
    page.waitForFunction(() => document.querySelectorAll('.thumb').length === 4, { timeout: 90000 }),
    dialogP,
  ])

  const thumbCount = await page.evaluate(() => document.querySelectorAll('.thumb').length)
  check('多选上传后没有出现「读不出来」弹窗', dialogs.length === 0, dialogs.join(' | '))
  check('4 张照片都进入待保存列表', thumbCount === 4, `thumbs=${thumbCount}`)

  // 逐张点缩略图，验证预览能解码、且 livp/heic 已转成 JPEG
  const expected = ['image/jpeg', 'image/jpeg', 'image/jpeg', 'image/png']
  const names = ['.livp 实况照片', '假 .livp（HEIC 改后缀）', '.heic 直传', '.png 基线']
  for (let i = 0; i < 4; i++) {
    if (i > 0) {
      const prevSrc = await page.evaluate((idx) => {
        const src = document.querySelector('img.preview')?.src ?? ''
        document.querySelectorAll('.thumb')[idx]?.click()
        return src
      }, i)
      await page.waitForFunction(
        (p) => {
          const img = document.querySelector('img.preview')
          return img && img.src !== p && img.naturalWidth > 0
        },
        { timeout: 20000 },
        prevSrc,
      )
    } else {
      await page.waitForFunction(() => document.querySelector('img.preview')?.naturalWidth > 0, { timeout: 20000 })
    }
    const info = await page.evaluate(async () => {
      const img = document.querySelector('img.preview')
      const blob = await (await fetch(img.src)).blob()
      return { type: blob.type, size: blob.size, w: img.naturalWidth, h: img.naturalHeight }
    })
    check(`${names[i]}：浏览器可解码`, info.w > 0, `${info.w}x${info.h}, ${info.size}B`)
    check(`${names[i]}：归一化类型`, info.type === expected[i], `期望 ${expected[i]}，实际 ${info.type}`)
  }
} catch (e) {
  failed = true
  console.error('测试执行出错:', e)
} finally {
  await browser.close()
  server.close()
}

failed = failed || checks.some((c) => !c.ok)
console.log(failed ? '\n❌ E2E 失败' : '\n✅ E2E 全部通过')
process.exit(failed ? 1 : 0)
