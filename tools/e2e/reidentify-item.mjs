/**
 * 编辑页「重新识别」（单件、覆盖模式）端到端测试（真实 Chrome，无头模式）
 *
 * 本地桩 server 模拟方舟 chat/completions：返回固定识别结果
 * {category:'bottom', colors:['黑'], styles:['运动'], season:'冬', brand:'Nike', material:'尼龙'}。
 *
 * 断言：
 * 1) 编辑页有「重新识别」入口，点击后走后台队列（overwrite）；
 * 2) 识别完成后结果自动填入表单（分类/颜色/品牌/材质等），并提示核对后保存；
 * 3) 价格/备注等手填内容在表单里保留；
 * 4) 点「保存修改」后写入 IDB：识别字段被覆盖，手填字段不变。
 *
 * 用法：npm run build && CHROME_PATH=... node tools/e2e/reidentify-item.mjs
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
      }, 800).unref()
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
page.on('dialog', (d) => d.accept()) // confirm(覆盖警告) 自动确定

// ---------- 往 IDB 塞设置 + 1 件「分类错、字段全」的衣服 ----------
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
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('wardrobe')
    q.onsuccess = () => res(q.result)
    q.onerror = () => rej(q.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction(['items', 'settings'], 'readwrite')
    tx.objectStore('items').put({
      id: 'item-1',
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
    tx.objectStore('settings').put({ key: 'main', value: { doubaoApiKey: 'e2e-key', aiProxyUrl: stubBase } })
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  db.close()
}, stubBase)

const readItem = () =>
  page.evaluate(async () => {
    const db = await new Promise((res) => { const q = indexedDB.open('wardrobe'); q.onsuccess = () => res(q.result) })
    const item = await new Promise((res) => { const q = db.transaction('items').objectStore('items').get('item-1'); q.onsuccess = () => res(q.result) })
    db.close()
    return item
  })

// ---------- 衣柜页点卡片进编辑页 ----------
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('xpath/.//button[contains(., "衣柜")]')
await page.click('xpath/.//button[contains(., "衣柜")]')
await page.waitForSelector('xpath/.//button[contains(@class, "card-img")]', { timeout: 10000 })
await page.click('xpath/.//button[contains(@class, "card-img")]')
await page.waitForSelector('xpath/.//h1[contains(., "编辑衣服")]', { timeout: 10000 })

// ---------- 点「重新识别」 ----------
await page.waitForSelector('xpath/.//button[contains(., "重新识别")]')
check('编辑页有「重新识别」入口', true)
await page.click('xpath/.//button[contains(., "重新识别")]')

// ---------- 等识别完成并填入表单 ----------
await page.waitForFunction(() => document.body.innerText.includes('已重新识别'), { timeout: 20000 })
check('识别完成后提示已填入表单', true)

const formState = await page.evaluate(() => {
  const onBtn = (text) => [...document.querySelectorAll('button.on')].some((b) => b.innerText.trim() === text)
  const inputVal = (ph) => document.querySelector(`input[placeholder="${ph}"]`)?.value ?? null
  return {
    categoryBottom: onBtn('下装'),
    seasonWinter: onBtn('冬'),
    styleSport: onBtn('运动'),
    colors: inputVal('其他颜色，空格分隔'),
    brand: inputVal('其他品牌，手动输入'),
    material: inputVal('其他材质，手动输入'),
    price: inputVal('也可输入精确价格'),
    note: [...document.querySelectorAll('input')].some((i) => i.value === '手填备注'),
  }
})
check('表单分类变为「下装」（修正错分）', formState.categoryBottom, JSON.stringify(formState))
check('表单颜色/品牌/材质被 AI 结果填入', formState.colors === '黑' && formState.brand === 'Nike' && formState.material === '尼龙', JSON.stringify(formState))
check('表单季节/风格同步更新', formState.seasonWinter && formState.styleSport)
check('表单价格/备注手填内容保留', formState.price === '199' && formState.note === true, JSON.stringify({ price: formState.price, note: formState.note }))

// ---------- 保存修改，写入 IDB ----------
await page.click('xpath/.//button[contains(., "保存修改")]')
await page.waitForFunction(() => document.body.innerText.includes('我的衣柜'), { timeout: 10000 })
await new Promise((r) => setTimeout(r, 500))

const it = await readItem()
check('识别只调用 1 次', chatCalls === 1, `${chatCalls} 次`)
check('IDB：分类/季节/颜色/风格/材质/品牌被覆盖', !!it && it.category === 'bottom' && it.season === '冬' && it.colors.join() === '黑' && it.styles.join() === '运动' && it.material === '尼龙' && it.brand === 'Nike', it ? JSON.stringify({ category: it.category, season: it.season, colors: it.colors, styles: it.styles, material: it.material, brand: it.brand }) : 'item missing')
check('IDB：价格/备注/尺码/穿着次数保留', !!it && it.price === 199 && it.note === '手填备注' && it.size === 'M' && it.wearCount === 3)

await browser.close()
stub.close()
staticServer.close()
const failed = checks.filter((c) => !c.ok).length
console.log(failed ? `❌ ${failed} 项失败` : '✅ 单件重新识别 E2E 全部通过')
process.exit(failed ? 1 : 0)
