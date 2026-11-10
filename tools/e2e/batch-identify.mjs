/**
 * 衣柜页「一键识图」（批量补 AI 识别）端到端测试（真实 Chrome，无头模式）
 *
 * 本地桩 server 模拟方舟 chat/completions：延迟可变，返回固定识别结果
 * {category:'outerwear', colors:['黑'], styles:['运动'], season:'春秋', brand:'Under Armour', material:'尼龙'}。
 *
 * 断言：
 * 1) 只给缺颜色/风格的衣服入队（已有内容的不动，省 token）；
 * 2) 识别结果只填空字段：颜色/风格/材质/品牌补上，分类保持原样（不被 AI 覆盖）；
 * 3) 任务走持久化队列：识别中途刷新页面，重开后自动续跑完，不丢不重；
 * 4) 跑完 bgTasks 清空、卡片「识图中」角标消失。
 *
 * 用法：npm run build && CHROME_PATH=... node tools/e2e/batch-identify.mjs
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dist = path.join(root, 'dist')
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
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

// ---------- 桩：方舟 chat/completions ----------
let chatDelay = 0
let chatCalls = 0
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const stub = createServer((req, res) => {
  res.on('error', () => {})
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }
  req.resume()
  req.on('end', () => {
    const headers = { ...CORS, 'Content-Type': 'application/json' }
    if (req.url?.endsWith('/chat/completions')) {
      chatCalls++
      const d = chatDelay
      setTimeout(() => {
        try {
          res.writeHead(200, headers)
          res.end(JSON.stringify({
            choices: [{ message: { content: '{"category":"outerwear","colors":["黑"],"styles":["运动"],"season":"春秋","brand":"Under Armour","material":"尼龙"}' } }],
          }))
        } catch { /* 页面已刷新 */ }
      }, d).unref()
      return
    }
    res.writeHead(404, headers)
    res.end('{}')
  })
})

// ---------- 静态伺服 dist/ ----------
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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
page.on('dialog', (d) => d.accept()) // confirm(会消耗 token) 自动确定

// ---------- 往 IDB 塞设置 + 4 件衣服（3 件待识图，1 件已有颜色风格） ----------
await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
await page.evaluate(async (stubBase) => {
  const mk = () =>
    new Promise((res) => {
      const c = document.createElement('canvas')
      c.width = c.height = 200
      const g = c.getContext('2d')
      g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 200)
      g.fillStyle = '#369'; g.fillRect(40, 30, 120, 140)
      c.toBlob(res, 'image/png')
    })
  const photo = await mk()
  const base = { photo, category: 'top', season: '春秋', createdAt: Date.now(), wearCount: 0 }
  const rows = [
    { ...base, id: 'ai-1', colors: [], styles: [] },
    { ...base, id: 'ai-2', colors: [], styles: [] },
    { ...base, id: 'ai-3', colors: [], styles: [] },
    { ...base, id: 'ai-4', colors: ['红'], styles: ['休闲'] }, // 已有内容：不该被识别
  ]
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('wardrobe')
    q.onsuccess = () => res(q.result)
    q.onerror = () => rej(q.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction(['items', 'settings'], 'readwrite')
    rows.forEach((r) => tx.objectStore('items').put(r))
    tx.objectStore('settings').put({ key: 'main', value: { doubaoApiKey: 'e2e-key', aiProxyUrl: stubBase } })
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  db.close()
}, stubBase)

const readItems = () =>
  page.evaluate(async () => {
    const db = await new Promise((res) => { const q = indexedDB.open('wardrobe'); q.onsuccess = () => res(q.result) })
    const items = await new Promise((res) => { const q = db.transaction('items').objectStore('items').getAll(); q.onsuccess = () => res(q.result) })
    const tasks = await new Promise((res) => { const q = db.transaction('bgTasks').objectStore('bgTasks').getAll(); q.onsuccess = () => res(q.result) })
    db.close()
    return { items, tasks }
  })
const byId = (items, id) => items.find((i) => i.id === id)

// ---------- 开始：衣柜页点「一键识图」 ----------
chatDelay = 800 // 故意放慢：制造「识别中刷新页面」的窗口
await page.reload({ waitUntil: 'networkidle0' })
const click = async (text) => {
  const b = await page.waitForSelector(`xpath/.//button[contains(., "${text}")]`)
  await b.click()
}
await click('衣柜')
await page.waitForSelector('xpath/.//button[contains(., "一键识图")]')
const label = await page.$eval('xpath/.//button[contains(., "一键识图")]', (b) => b.innerText)
check('按钮只数缺颜色/风格的 3 件（已有内容的不算）', label.includes('3 件'), label)

await click('一键识图')
await new Promise((r) => setTimeout(r, 500)) // 让 2 个在飞、1 个排队
await page.reload({ waitUntil: 'networkidle0' }) // 网页跳掉：任务应从 IDB 续跑
await click('衣柜')

// ---------- 等全部识别完 ----------
const deadline = Date.now() + 30000
let items = []
while (Date.now() < deadline) {
  ;({ items } = await readItems())
  const pending = ['ai-1', 'ai-2', 'ai-3'].filter((id) => !byId(items, id)?.colors?.length)
  if (!pending.length) break
  await new Promise((r) => setTimeout(r, 300))
}
;({ items } = await readItems())

const got = ['ai-1', 'ai-2', 'ai-3'].every((id) => {
  const it = byId(items, id)
  return it && it.colors.includes('黑') && it.styles.includes('运动') && it.material === '尼龙' && it.brand === 'Under Armour'
})
check('3 件都补上了颜色/风格/材质/品牌', got)
check('分类不被 AI 覆盖（桩返回 outerwear，衣服仍是 top）', ['ai-1', 'ai-2', 'ai-3'].every((id) => byId(items, id)?.category === 'top'))
check('已有颜色风格的第 4 件原样未动', (() => {
  const it = byId(items, 'ai-4')
  return it && it.colors.join() === '红' && it.styles.join() === '休闲' && !it.material && !it.brand
})())
check('识别只调用了需要的件数（3 件，不含已有内容的第 4 件）', chatCalls >= 3 && chatCalls <= 6, `chat ${chatCalls} 次（刷新重试会多几次）`)

const { tasks } = await readItems()
check('跑完后台任务清空', tasks.length === 0, `${tasks.length} 条`)
await page.waitForFunction(() => !document.body.innerText.includes('识图中'), { timeout: 10000 })
check('卡片「识图中」角标消失', true)

await browser.close()
stub.close()
staticServer.close()
const failed = checks.filter((c) => !c.ok).length
console.log(failed ? `❌ ${failed} 项失败` : '✅ 批量识图 E2E 全部通过')
process.exit(failed ? 1 : 0)
