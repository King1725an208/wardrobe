// 今日穿搭页 E2E：天气（模拟 18° 小雨）→ 推荐选中 → 每类一行换一件 → 就穿这套 → 改一件 → 照片自动存 → 先拍照后选衣服
// 先 npm run build，再：CHROME_PATH=... node tools/e2e/today-pick.mjs
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dbAll = (store) =>
  page.evaluate(async (store) => {
    const db = await new Promise((res) => { const q = indexedDB.open('wardrobe'); q.onsuccess = () => res(q.result) })
    const all = await new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result) })
    db.close()
    return all
  }, store)
const outfits = () => dbAll('outfits')
const wear = async () => Object.fromEntries((await dbAll('items')).map((i) => [i.id, i.wearCount]))
const selected = () => page.$$eval('.rec .rec-tile.on', (x) => x.map((e) => `${e.dataset.cat}:${e.dataset.id}`))
const cats = (sel) => sel.map((s) => s.split(':')[0])
const btnText = () => page.$eval('.rec .rec-btns button.primary', (b) => b.innerText)
const tapUnselected = async (cat) => {
  const t = await page.$(`.pick-row[data-cat="${cat}"] .rec-tile:not(.on)`)
  await t.click()
  await sleep(200)
  return page.evaluate((e) => e.dataset.id, t)
}
// 测试用照片
const jpg = path.join(os.tmpdir(), 'today-e2e.jpg')
const dataUrl = await page.evaluate(() => {
  const c = document.createElement('canvas')
  c.width = 300; c.height = 400
  const g = c.getContext('2d')
  g.fillStyle = '#89a'; g.fillRect(0, 0, 300, 400)
  return c.toDataURL('image/jpeg', 0.8)
})
await writeFile(jpg, Buffer.from(dataUrl.split(',')[1], 'base64'))
const upload = async () => {
  const input = await page.$('.rec input[type=file]')
  await input.uploadFile(jpg)
  await page.waitForSelector('.rec-photo img')
  await sleep(300)
}

await click('今日穿搭')
await page.waitForSelector('.rec-tile.on')
const wx = await page.$eval('.wx', (e) => e.innerText.replace(/\n/g, ' '))
ok(/18°.*小雨.*14~19°C.*记得带伞/.test(wx), '天气卡显示模拟的 18° 小雨', wx)
const rowCats = await page.$$eval('.pick-row', (x) => x.map((e) => e.dataset.cat).join(','))
ok(rowCats === 'outerwear,top,dress,bottom,shoes,bag' && !(await page.$('.pick-grid')), '每类一行，不再把所有衣服堆在一起', rowCats)
const c1 = cats(await selected())
ok(c1.includes('outerwear') && ((c1.includes('top') && c1.includes('bottom')) || c1.includes('dress')), '推荐的一套已选中，下雨 19° 带外套', c1.join())
const firstOn = await page.$$eval('.pick-row', (rows) => rows.every((r) => !r.querySelector('.rec-tile.on') || r.querySelector('.rec-tile').classList.contains('on')))
ok(firstOn, '推荐的那件排在每行最前面')
const why = await page.$eval('.rec-why', (e) => e.innerText.replace(/\n/g, ' / '))
ok(why.includes('挡雨'), '推荐理由', why)
if (SHOT) await page.screenshot({ path: `${SHOT}/today-pick.png`, fullPage: true })

const s1 = (await selected()).join()
await click('换一套')
await sleep(300)
ok((await selected()).join() !== s1, '换一套后选中的变了')

// 鞋那行点另一双：只换鞋
const before = await selected()
const shoe = await tapUnselected('shoes')
const after = await selected()
ok(after.includes(`shoes:${shoe}`) && after.length === before.length && after.filter((x) => !x.startsWith('shoes')).join() === before.filter((x) => !x.startsWith('shoes')).join(), '点同一行的另一双鞋：只换鞋')

// 连衣裙和上衣/下装互斥
const hadDress = cats(after).includes('dress')
if (hadDress) { await tapUnselected('top'); await tapUnselected('bottom') }
await page.$eval('.pick-row[data-cat="dress"] .rec-tile', (e) => e.click())
await sleep(200)
const d = cats(await selected())
ok(d.includes('dress') && !d.includes('top') && !d.includes('bottom'), '选连衣裙会去掉上衣和下装', d.join())
await tapUnselected('top')
await tapUnselected('bottom')
const tb = cats(await selected())
ok(!tb.includes('dress') && tb.includes('top') && tb.includes('bottom'), '再选上衣+下装会去掉连衣裙', tb.join())

const sel1 = await selected()
await click('就穿这套')
await page.waitForFunction(() => document.body.innerText.includes('今天已记录'))
let os1 = await outfits()
let w = await wear()
ok(os1.length === 1 && os1[0].itemIds.length === sel1.length, '就穿这套 → 记成今天的穿搭', `${os1.length} 条，${os1[0]?.itemIds.length} 件`)
ok(Object.values(w).filter((n) => n === 1).length === sel1.length, '这几件的穿着次数 +1')

// 改一件上衣 → 保存修改：仍是同一条，旧上衣次数撤回
const oldTop = sel1.find((x) => x.startsWith('top:')).split(':')[1]
const newTop = await tapUnselected('top')
ok((await btnText()).includes('保存修改'), '改了一件后按钮变成「保存修改」')
await click('保存修改')
await page.waitForFunction(() => document.body.innerText.includes('今天已记录'))
os1 = await outfits()
w = await wear()
ok(os1.length === 1 && os1[0].itemIds.includes(newTop) && !os1[0].itemIds.includes(oldTop), '保存修改更新同一条记录', `${os1.length} 条`)
ok(w[oldTop] === 0 && w[newTop] === 1, '换下的上衣穿着次数撤回，换上的 +1', `旧 ${w[oldTop]} 新 ${w[newTop]}`)

// 加照片：选完就自动存，不用再点保存
await upload()
os1 = await outfits()
ok(os1.length === 1 && !!os1[0].photo && os1[0].itemIds.includes(newTop), '照片选完自动存进今天这条记录')
ok((await btnText()).includes('今天已记录'), '加照片后仍显示已记录')

// 刷新：选中的、照片都还在
const s2 = (await selected()).sort().join()
await page.reload({ waitUntil: 'networkidle0' })
await click('今日穿搭')
await page.waitForSelector('.rec-tile.on')
ok((await selected()).sort().join() === s2 && !!(await page.$('.rec-photo img')) && (await btnText()).includes('今天已记录'), '刷新后显示今天记下的那套和照片')

const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
ok(!overflow, '手机宽度不横向溢出')

// 先拍照、后选衣服：清空今天记录和穿着次数再来
await page.evaluate(async () => {
  const db = await new Promise((res) => { const q = indexedDB.open('wardrobe'); q.onsuccess = () => res(q.result) })
  const items = await new Promise((res) => { const q = db.transaction('items').objectStore('items').getAll(); q.onsuccess = () => res(q.result) })
  await new Promise((res) => {
    const tx = db.transaction(['items', 'outfits'], 'readwrite')
    tx.objectStore('outfits').clear()
    items.forEach((i) => tx.objectStore('items').put({ ...i, wearCount: 0, lastWornAt: undefined }))
    tx.oncomplete = res
  })
  db.close()
})
await page.reload({ waitUntil: 'networkidle0' })
await click('今日穿搭')
await page.waitForSelector('.rec-tile.on')
await upload()
os1 = await outfits()
w = await wear()
ok(os1.length === 1 && !!os1[0].photo && os1[0].itemIds.length === 0 && Object.values(w).every((n) => n === 0), '先拍照：照片先存上，不会自动算穿过')
ok((await btnText()).includes('就穿这套'), '先拍照后按钮仍是「就穿这套」')
await click('就穿这套')
await page.waitForFunction(() => document.body.innerText.includes('今天已记录'))
os1 = await outfits()
ok(os1.length === 1 && !!os1[0].photo && os1[0].itemIds.length > 0, '再点就穿这套：衣服和照片在同一条记录里')
if (SHOT) await page.screenshot({ path: `${SHOT}/today-photo.png`, fullPage: true })

await browser.close()
server.close()
console.log(fail ? `❌ ${fail} 项失败` : '✅ 今日穿搭 E2E 全部通过')
process.exit(fail ? 1 : 0)
