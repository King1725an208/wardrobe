// 今日推荐页面 E2E：天气（模拟 18° 小雨）→ 一套推荐 → 换一套 → 单换一件 → 就穿这套 → 改成别的一套
// 先 npm run build，再：CHROME_PATH=... node tools/e2e/today-pick.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = path.join(ROOT, 'dist')
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
const SHOT = process.env.SHOT_DIR
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/wardrobe/, '')
  if (p === '/' || p === '') p = '/index.html'
  try {
    const body = await readFile(path.join(DIST, p))
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(0)
const URL = `http://localhost:${server.address().port}/wardrobe/`

let fail = 0
const ok = (c, name, extra = '') => {
  console.log(`${c ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!c) fail++
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
page.on('dialog', (d) => d.accept())
await page.setRequestInterception(true)
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('open-meteo'))
    return r.respond({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ current: { temperature_2m: 17.6, weather_code: 61 }, daily: { weather_code: [61], temperature_2m_max: [19], temperature_2m_min: [14], precipitation_probability_max: [85] } }),
    })
  if (u.includes('jsdelivr'))
    return r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"days":[]}' })
  r.continue()
})
await page.goto(URL, { waitUntil: 'networkidle0' })

// 往 IndexedDB 塞一组衣服（带色块图）
await page.evaluate(async () => {
  const mk = (color) =>
    new Promise((res) => {
      const c = document.createElement('canvas')
      c.width = c.height = 200
      const g = c.getContext('2d')
      g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 200)
      g.fillStyle = color; g.fillRect(40, 30, 120, 140)
      c.toBlob(res, 'image/png')
    })
  const spec = [
    ['top', '春秋', '#333', ['黑'], ['通勤']], ['top', '春秋', '#c66', ['红'], ['休闲']], ['top', '春秋', '#ddd', ['灰'], ['通勤']],
    ['bottom', '春秋', '#235', ['藏青'], ['通勤']], ['bottom', '春秋', '#a87', ['卡其'], ['休闲']],
    ['outerwear', '春秋', '#975', ['驼色'], ['通勤']], ['outerwear', '春秋', '#555', ['灰'], ['休闲']],
    ['dress', '春秋', '#7a5', ['墨绿'], ['甜美']],
    ['shoes', '春秋', '#111', ['黑'], []], ['shoes', '春秋', '#eee', ['白'], []], ['bag', '春秋', '#842', ['咖啡'], []],
  ]
  const db = await new Promise((res, rej) => { const q = indexedDB.open('wardrobe'); q.onsuccess = () => res(q.result); q.onerror = rej })
  const rows = []
  for (const [i, [category, season, color, colors, styles]] of spec.entries())
    rows.push({ id: `e2e-${i}`, photo: await mk(color), category, season, colors, styles, createdAt: Date.now() - i, wearCount: 0 })
  await new Promise((res, rej) => {
    const tx = db.transaction('items', 'readwrite')
    rows.forEach((r) => tx.objectStore('items').put(r))
    tx.oncomplete = res; tx.onerror = rej
  })
  db.close()
})
await page.reload({ waitUntil: 'networkidle0' })
const click = async (text) => {
  const b = await page.waitForSelector(`xpath/.//button[contains(., "${text}")]`)
  await b.click()
}
const recIds = () =>
  page.$$eval('.rec-tile img', (imgs) => imgs.map((i) => i.src)).then(() =>
    page.evaluate(() => [...document.querySelectorAll('.rec-cat')].map((e) => e.textContent).join(',')))
const outfits = () =>
  page.evaluate(async () => {
    const db = await new Promise((res) => { const q = indexedDB.open('wardrobe'); q.onsuccess = () => res(q.result) })
    const all = await new Promise((res) => { const q = db.transaction('outfits').objectStore('outfits').getAll(); q.onsuccess = () => res(q.result) })
    db.close()
    return all
  })
const tileSig = () => page.evaluate(() => [...document.querySelectorAll('.rec-tile')].map((i) => i.dataset.id).join('|'))

await click('今日穿搭')
await page.waitForSelector('.rec-tile')
const wx = await page.$eval('.wx', (e) => e.innerText.replace(/\n/g, ' '))
ok(/18°.*小雨.*14~19°C.*记得带伞/.test(wx), '天气卡显示模拟的 18° 小雨', wx)
const cats1 = await recIds()
ok(/外套/.test(cats1) && (/上衣/.test(cats1) && /下装/.test(cats1) || /连衣裙/.test(cats1)), '推荐结构完整且下雨 19° 带外套', cats1)
const why = await page.$eval('.rec-why', (e) => e.innerText.replace(/\n/g, ' / '))
ok(why.includes('挡雨'), '推荐理由', why)
if (SHOT) await page.screenshot({ path: `${SHOT}/today-pick.png` })

const sig1 = await tileSig()
await click('换一套')
await new Promise((r) => setTimeout(r, 300))
const sig2 = await tileSig()
ok(sig1 !== sig2, '换一套后图片变了')

// 单换鞋：只有鞋那格变
const shoeIdx = await page.evaluate(() => [...document.querySelectorAll('.rec-cat')].findIndex((e) => e.textContent.startsWith('鞋')))
const before = (await tileSig()).split('|')
await (await page.$$('.rec-tile'))[shoeIdx].click()
await new Promise((r) => setTimeout(r, 300))
const after = (await tileSig()).split('|')
ok(after[shoeIdx] !== before[shoeIdx] && after.filter((s, i) => i !== shoeIdx).join() === before.filter((s, i) => i !== shoeIdx).join(), '点鞋只换鞋')

await click('就穿这套')
await page.waitForFunction(() => document.body.innerText.includes('今天已记录'))
let os = await outfits()
ok(os.length === 1 && os[0].itemIds.length === after.length, '就穿这套 → 记成今天的穿搭', `${os.length} 条，${os[0]?.itemIds.length} 件`)
const worn = await page.evaluate(async () => {
  const db = await new Promise((res) => { const q = indexedDB.open('wardrobe'); q.onsuccess = () => res(q.result) })
  const all = await new Promise((res) => { const q = db.transaction('items').objectStore('items').getAll(); q.onsuccess = () => res(q.result) })
  db.close()
  return all.filter((i) => i.wearCount === 1).length
})
ok(worn === after.length, '这几件的穿着次数 +1', `${worn} 件`)
const picked = await page.$$eval('.pick-grid .thumb.on', (x) => x.length)
ok(picked === after.length, '下面「自己挑」也同步勾上', `${picked}`)

await click('换一套')
await page.waitForFunction(() => document.body.innerText.includes('改成这套'))
await click('改成这套')
await page.waitForFunction(() => document.body.innerText.includes('今天已记录'))
os = await outfits()
ok(os.length === 1, '改成另一套时更新同一条记录，不重复', `${os.length} 条`)

// 刷新后显示的就是今天记下的那套
const s1 = await tileSig()
await page.reload({ waitUntil: 'networkidle0' })
await click('今日穿搭')
await page.waitForSelector('.rec-tile')
ok((await tileSig()) === s1 && (await page.evaluate(() => document.body.innerText.includes('今天已记录'))), '刷新后显示今天记下的那套')

const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
ok(!overflow, '手机宽度不横向溢出')

await browser.close()
server.close()
console.log(fail ? `❌ ${fail} 项失败` : '✅ 今日推荐 E2E 全部通过')
process.exit(fail ? 1 : 0)
