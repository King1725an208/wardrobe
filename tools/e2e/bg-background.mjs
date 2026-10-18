/**
 * 后台化（P2-1 断点续跑 / P2-2 先存后补）端到端测试（真实 Chrome，无头模式）
 *
 * 本地桩 server 模拟方舟接口：chat 秒回固定识别结果；images/generations 按可变延迟
 * 回一张固定小图（fixtures/plain.png 的字节），并可注入一次 500 失败。
 *
 * 断言：
 * A) 先存后补·在飞交接：抠图途中直接保存 → 衣物先以原图入库（bgTasks 无任务），
 *    在飞调用回来后主图自动换成白底图、originalPhoto 备份原图，且全程只调用了 1 次生成（不重复扣费）；
 * A2) 先存后补·失败落任务：抠图 500 后保存 → bgTasks 落一条任务、卡片出「抠图中」角标，
 *    后台 runner 自动重试成功 → 换图、任务清除、角标消失；
 * B) 断点续跑：抠图途中刷新页面 → 批次从 IDB 恢复（loading 重置 idle）并自动重跑完成。
 *
 * 用法：npm run test:e2e（自动先 build 并跑完 photo-upload 再跑本测试）
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const parent = path.resolve(root, '..')
const dist = path.join(root, 'dist')
const PIC_DIR = path.join(parent, 'Wardrobe pic')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
}

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- 桩：方舟 API ----------
// 桩返回的「白底图」：1x1 透明 PNG（与 photo-upload.mjs 同一常量；App 只当字节存 Blob）
const TINY_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const TINY_SIZE = Buffer.from(TINY_B64, 'base64').length
let genDelay = 0
let failNext = false
let genCalls = 0
let chatCalls = 0
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const stub = createServer((req, res) => {
  res.on('error', () => {}) // 页面刷新会中断在飞请求，写回时静默
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }
  req.resume()
  // 必须等请求体收完再响应（App 会 POST 上百 KB 的 base64 图），否则连接可能被重置
  req.on('end', () => {
    const headers = { ...CORS, 'Content-Type': 'application/json' }
    if (req.url?.endsWith('/chat/completions')) {
      chatCalls++
      res.writeHead(200, headers)
      res.end(JSON.stringify({
        choices: [{ message: { content: '{"category":"outerwear","colors":["黑"],"styles":["运动"],"season":"春秋","brand":"Under Armour","material":"尼龙"}' } }],
      }))
      return
    }
    if (req.url?.endsWith('/images/generations')) {
      genCalls++
      const fail = failNext
      failNext = false
      const d = genDelay
      setTimeout(() => {
        try {
          if (fail) {
            res.writeHead(500, headers)
            res.end(JSON.stringify({ error: { message: 'stub 注入失败' } }))
          } else {
            res.writeHead(200, headers)
            res.end(JSON.stringify({ data: [{ b64_json: TINY_B64 }] }))
          }
        } catch { /* 页面已刷新 */ }
      }, d).unref()
      return
    }
    res.writeHead(404, headers)
    res.end('{}')
  })
})

// ---------- 静态伺服 dist/（保持 /wardrobe/ 子路径） ----------
const staticServer = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    if (p === '/') p = '/wardrobe/'
    if (p.endsWith('/')) p += 'index.html'
    const rel = p.replace(/^\/wardrobe\//, '')
    const file = path.join(dist, rel)
    if (!file.startsWith(dist)) throw new Error('bad path')
    const data = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})

await new Promise((r) => stub.listen(0, '127.0.0.1', r))
await new Promise((r) => staticServer.listen(0, '127.0.0.1', r))
const stubBase = `http://127.0.0.1:${stub.address().port}/api/plan/v3`
const appUrl = `http://127.0.0.1:${staticServer.address().port}/wardrobe/`
console.log(`桩方舟: ${stubBase}\n本地伺服: ${appUrl}`)
// ---------- 辅助 ----------
const pickFile = (token) => {
  const f = readdirSync(PIC_DIR).find((x) => x.includes(token) && /\.(jpe?g|png)$/i.test(x))
  if (!f) throw new Error('Wardrobe pic 里没找到含 ' + token + ' 的图')
  return f
}
/** 读某个 IDB store 的全部行（Blob 映射成 {size,type} 才能序列化） */
const idbAll = (page, store) =>
  page.evaluate(async (s) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('wardrobe')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const rows = await new Promise((res, rej) => {
      const q = db.transaction(s, 'readonly').objectStore(s).getAll()
      q.onsuccess = () => res(q.result)
      q.onerror = () => rej(q.error)
    })
    db.close()
    return rows.map((row) => {
      const c = {}
      for (const [k, v] of Object.entries(row)) c[k] = v instanceof Blob ? { size: v.size, type: v.type } : v
      return c
    })
  }, store)

async function waitFor(fn, what, timeout = 15000) {
  const t0 = Date.now()
  for (;;) {
    if (await fn()) return
    if (Date.now() - t0 > timeout) throw new Error('超时等待: ' + what)
    await new Promise((r) => setTimeout(r, 200))
  }
}
const waitText = (page, text, timeout = 15000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text)
async function clickButton(page, text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes(t) && !x.disabled)
    if (!b) return false
    b.click()
    return true
  }, text)
  if (!ok) throw new Error('按钮不可点: ' + text)
}
async function seedSettings(page) {
  await page.evaluate(async (proxy) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('wardrobe')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const tx = db.transaction('settings', 'readwrite')
    tx.objectStore('settings').put({ key: 'main', value: { doubaoApiKey: 'test-key', aiProxyUrl: proxy, removeBg: true } })
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error) })
    db.close()
  }, stubBase)
}

// ---------- 测试 ----------
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
let failed = 0
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto(appUrl, { waitUntil: 'networkidle0' })
  await waitText(page, '＋录入')
  await seedSettings(page)
  await page.reload({ waitUntil: 'networkidle0' })
  await waitText(page, '＋录入')

  // ===== A) 先存后补·在飞交接（不重复调用） =====
  genDelay = 8000
  await clickButton(page, '＋录入')
  const pic137 = path.join(PIC_DIR, pickFile('137'))
  const size137 = (await readFile(pic137)).length
  await (await page.waitForSelector('input[multiple]')).uploadFile(pic137)
  await waitText(page, 'AI 已预填') // 识别秒回；抠图还在飞（8s）
  await clickButton(page, '保存到衣柜')
  await waitFor(async () => (await idbAll(page, 'items')).length === 1, 'A 入库')
  let items = await idbAll(page, 'items')
  check('A 保存即入库：主图还是原图', items[0].photo.size === size137 && !items[0].originalPhoto, `photo=${items[0].photo.size}B 原图=${size137}B`)
  check('A 在飞交接不落 bgTasks 任务', (await idbAll(page, 'bgTasks')).length === 0)
  await waitFor(async () => (await idbAll(page, 'items'))[0]?.photo?.size === TINY_SIZE, 'A 自动换图', 20000)
  items = await idbAll(page, 'items')
  check('A 抠图回来主图自动换白底图', items[0].photo.size === TINY_SIZE, `photo=${items[0].photo.size}B`)
  check('A 原图备份到 originalPhoto', items[0].originalPhoto?.size === size137)
  check('A 全程只生成 1 次（交接不重复扣费）', genCalls === 1, `genCalls=${genCalls}`)
  // ===== A2) 失败落任务 → 后台 runner 重试成功 =====
  failNext = true
  genDelay = 0
  await clickButton(page, '＋录入')
  const pic139 = path.join(PIC_DIR, pickFile('139'))
  const size139 = (await readFile(pic139)).length
  await (await page.waitForSelector('input[multiple]')).uploadFile(pic139)
  await waitText(page, '去背景失败') // stub 注入的 500
  genDelay = 3000 // runner 重试放慢，留出观察窗口
  await clickButton(page, '保存到衣柜')
  await waitFor(async () => (await idbAll(page, 'bgTasks')).length === 1, 'A2 任务落盘')
  check('A2 抠图失败保存后落后台任务', true)
  await waitFor(async () => page.evaluate(() => !!document.querySelector('.bg-pending')), 'A2 角标')
  check('A2 卡片显示「抠图中」角标', true)
  await waitFor(
    async () => (await idbAll(page, 'items')).some((i) => i.photo.size === TINY_SIZE && i.originalPhoto?.size === size139),
    'A2 自动换图',
    15000,
  )
  check('A2 runner 重试成功自动换白底图', true)
  await waitFor(async () => (await idbAll(page, 'bgTasks')).length === 0, 'A2 任务清除')
  check('A2 任务清除、角标消失', await page.evaluate(() => !document.querySelector('.bg-pending')))

  // ===== B) 断点续跑：抠图途中刷新页面 =====
  genDelay = 60_000
  const genBeforeB = genCalls
  await clickButton(page, '＋录入')
  await (await page.waitForSelector('input[multiple]')).uploadFile(path.join(PIC_DIR, pickFile('134')))
  await waitFor(async () => (await idbAll(page, 'addQueue')).some((r) => r.bg === 'loading'), 'B 批次落盘')
  genDelay = 0 // 重跑秒回
  await page.reload({ waitUntil: 'networkidle0' })
  await clickButton(page, '＋录入') // 回到录入页 → 恢复的批次自动续跑
  await waitFor(async () => page.evaluate(() => !!document.querySelector('img.preview')), 'B 批次恢复')
  check('B 刷新后批次照片还在', true)
  await waitFor(
    async () => (await idbAll(page, 'addQueue')).some((r) => r.bg === 'done' && r.cutout?.size === TINY_SIZE),
    'B 续跑完成',
    15000,
  )
  check('B 中断的抠图自动重跑完成', true)
  check('B 刷新前那次调用作废、只重跑 1 次', genCalls - genBeforeB === 2, `genCalls=${genCalls}`)
  await waitText(page, 'AI 已预填')
  check('B 识别结果也在', true)

  check('总生成调用 = 5（A1 + A2×2 + B×2）', genCalls === 5, `genCalls=${genCalls}, chatCalls=${chatCalls}`)
} catch (e) {
  failed = 1
  console.error('❌ 异常:', e instanceof Error ? e.message : e)
} finally {
  await browser.close()
  stub.close()
  staticServer.close()
}

const bad = checks.filter((c) => !c.ok)
if (bad.length || failed) {
  console.error(`\n❌ ${bad.length + failed} 项未过`)
  process.exit(1)
}
console.log(`\n✅ 后台化 E2E 全部通过（${checks.length} 项）`)


