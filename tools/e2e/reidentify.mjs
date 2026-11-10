/**
 * 衣柜页「重新识图」（覆盖模式）端到端测试（真实 Chrome，无头模式）
 *
 * 本地桩 server 模拟方舟 chat/completions：返回固定识别结果
 * {category:'bottom', colors:['黑'], styles:['运动'], season:'冬', brand:'Nike', material:'尼龙'}。
 *
 * 断言：
 * 1) 已有颜色/风格的衣服不再出现在「一键识图」，但「重新识图」覆盖当前筛选全部；
 * 2) 入队任务 mode='overwrite'（持久化在 IDB bgTasks，刷新不丢）；
 * 3) 识别完成后分类/季节/颜色/风格/材质/品牌被 AI 结果覆盖；
 * 4) 价格/备注/尺码/穿着次数等手填内容原样保留；
 * 5) 跑完 bgTasks 清空。
 *
 * 用法：npm run build && CHROME_PATH=... node tools/e2e/reidentify.mjs
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
      setTimeout(() => {
        try {
          res.writeHead(200, headers)
          res.end(JSON.stringify({
            choices: [{ message: { content: '{"category":"bottom","colors":["黑"],"styles":["运动"],"season":"冬","brand":"Nike","material":"尼龙"}' } }],
          }))
        } catch { /* 页面已刷新 */ }
      }, 1200).unref() // 放慢：留出检查「任务已入队」的窗口
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
page.on('dialog', (d) => d.accept()) // confirm(覆盖模式警告) 自动确定

// ---------- 往 IDB 塞设置 + 2 件「分类错、字段全」的衣服 ----------
await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
await page.evaluate(async (stubBase) => {
  const mk = () =>
    new Promise((res) => {
      const c = document.createElement('canvas')
      c.width = c.height = 200
      const g = c.getContext('2d')
      g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 200)
      g.fillStyle = '#963'; g.fillRect(40, 30, 120, 140)
      c.toBlob(res, 'image/png')
    })
  const photo = await mk()
  const mkItem = (id) => ({
    id,
    photo,
    category: 'top', // 故意错分：其实是裤子
    season: '春秋',
    colors: ['红'],
    styles: ['休闲'],
    material: '棉',
    brand: '优衣库',
    price: 199,
    note: '手填备注',
    size: 'M',
    createdAt: Date.now(),
    wearCount: 3,
    lastWornAt: Date.now(),
  })
  const rows = [mkItem('re-1'), mkItem('re-2')]
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

// ---------- 衣柜页：已有内容的衣服不出现在「一键识图」，但「重新识图」覆盖全部 ----------
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('xpath/.//button[contains(., "衣柜")]')
await page.click('xpath/.//button[contains(., "衣柜")]')
await page.waitForSelector('xpath/.//button[contains(., "重新识图")]')

const hasFillBtn = await page.evaluate(() => document.body.innerText.includes('一键识图'))
check('字段已全的衣服不触发「一键识图」（只补空字段）', !hasFillBtn)
const redoLabel = await page.$eval('xpath/.//button[contains(., "重新识图")]', (b) => b.innerText)
check('「重新识图」覆盖当前筛选全部 2 件', redoLabel.includes('2 件'), redoLabel)

await page.click('xpath/.//button[contains(., "重新识图")]')
await new Promise((r) => setTimeout(r, 400)) // 让任务落盘

// ---------- 任务以 overwrite 模式入队 ----------
{
  const { tasks } = await readItems()
  check('入队 2 条识图任务且 mode=overwrite', tasks.length === 2 && tasks.every((t) => t.kind === 'ai' && t.mode === 'overwrite'), JSON.stringify(tasks.map((t) => ({ kind: t.kind, mode: t.mode }))))
}

// ---------- 等识别完成 ----------
const deadline = Date.now() + 30000
let items = []
while (Date.now() < deadline) {
  ;({ items } = await readItems())
  if (items.every((i) => i.category === 'bottom')) break
  await new Promise((r) => setTimeout(r, 300))
}

const okOverwrite = ['re-1', 're-2'].every((id) => {
  const it = items.find((i) => i.id === id)
  return it
    && it.category === 'bottom' // 分类被覆盖（修错分的关键）
    && it.season === '冬'
    && it.colors.join() === '黑'
    && it.styles.join() === '运动'
    && it.material === '尼龙'
    && it.brand === 'Nike'
})
check('分类/季节/颜色/风格/材质/品牌被 AI 结果覆盖', okOverwrite, JSON.stringify(items.map((i) => ({ id: i.id, category: i.category, season: i.season, colors: i.colors, styles: i.styles, material: i.material, brand: i.brand }))))

const okKeep = ['re-1', 're-2'].every((id) => {
  const it = items.find((i) => i.id === id)
  return it && it.price === 199 && it.note === '手填备注' && it.size === 'M' && it.wearCount === 3 && it.lastWornAt
})
check('价格/备注/尺码/穿着次数等手填内容保留', okKeep)

check('识别调用了 2 次', chatCalls === 2, `${chatCalls} 次`)

const { tasks } = await readItems()
check('跑完后台任务清空', tasks.length === 0, `${tasks.length} 条`)

await browser.close()
stub.close()
staticServer.close()
const failed = checks.filter((c) => !c.ok).length
console.log(failed ? `❌ ${failed} 项失败` : '✅ 重新识图 E2E 全部通过')
process.exit(failed ? 1 : 0)
