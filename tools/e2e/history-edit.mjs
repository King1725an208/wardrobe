// 历史穿搭 E2E：同类并排、编辑过去记录与穿着次数
// 先 npm run build，再：SHOT_DIR=/tmp/shots CHROME_PATH=... node tools/e2e/history-edit.mjs
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
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
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) fail++
}
const dateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const past = new Date()
past.setDate(past.getDate() - 3)
const pastDate = dateString(past)
const pastTs = new Date(pastDate + 'T12:00:00').getTime()

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  page.on('dialog', (d) => d.accept())
  page.on('pageerror', (error) => console.log('页面异常:', error.message))
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

  await page.evaluate(async ({ pastDate, pastTs }) => {
    const mk = (color) =>
      new Promise((res) => {
        const c = document.createElement('canvas')
        c.width = c.height = 200
        const g = c.getContext('2d')
        g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 200)
        g.fillStyle = color; g.fillRect(40, 30, 120, 140)
        c.toBlob(res, 'image/png')
      })
    const specs = [
      ['top-a', 'top', '#333'],
      ['top-b', 'top', '#c66'],
      ['top-c', 'top', '#369'],
      ['top-d', 'top', '#963'],
      ['bottom-x', 'bottom', '#235'],
      ['bottom-y', 'bottom', '#a87'],
      ['outerwear-1', 'outerwear', '#975'],
      ['shoes-1', 'shoes', '#111'],
    ]
    const db = await new Promise((res, rej) => { const q = indexedDB.open('wardrobe'); q.onsuccess = () => res(q.result); q.onerror = rej })
    const rows = []
    for (const [i, [id, category, color]] of specs.entries()) {
      const worn = ['top-a', 'top-b', 'bottom-x', 'shoes-1'].includes(id)
      rows.push({
        id, photo: await mk(color), category, season: '春秋', colors: ['黑'], styles: ['通勤'],
        createdAt: Date.now() - i, wearCount: worn ? 1 : 0, lastWornAt: worn ? pastTs : undefined,
      })
    }
    const outfit = {
      id: 'past-1', date: pastDate, itemIds: ['top-a', 'top-b', 'bottom-x', 'shoes-1'],
      weather: '12° 阴 · 8~14°C', note: '旧感想', createdAt: 1700000000000,
    }
    await new Promise((res, rej) => {
      const tx = db.transaction(['items', 'outfits'], 'readwrite')
      rows.forEach((row) => tx.objectStore('items').put(row))
      tx.objectStore('outfits').put(outfit)
      tx.oncomplete = res; tx.onerror = rej
    })
    db.close()
  }, { pastDate, pastTs })

  await page.reload({ waitUntil: 'networkidle0' })
  await page.click('.tabbar button:nth-child(2)')
  await page.waitForSelector('.outfit')
  const card = '.outfit'
  await page.click(`${card} .outfit-head .muted`)
  await page.waitForSelector('.outfit .bd-row.multi')
  const layout = await page.$eval(`${card} .bd-row.multi`, (row) => {
    const tops = [...row.querySelectorAll('.bd-item')]
    return { count: tops.length, offsets: tops.map((el) => el.offsetTop), scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }
  })
  ok(layout.count === 2 && layout.offsets[0] === layout.offsets[1], '两件上衣处于同一行', JSON.stringify(layout.offsets))
  ok(layout.scrollWidth <= layout.innerWidth, '历史展开无横向溢出', `${layout.scrollWidth}/${layout.innerWidth}`)
  if (SHOT) {
    await mkdir(SHOT, { recursive: true })
    await page.screenshot({ path: path.join(SHOT, 'history-expanded.png'), fullPage: true })
  }

  await page.click(`${card} .outfit-head button`)
  await page.waitForFunction(() => [...document.querySelectorAll('.outfit .rec .rec-head b')].some((e) => e.innerText === '修改这天的穿搭'))
  const editSelector = `${card} .rec`
  const editState = await page.$eval(editSelector, (editor) => ({
    selected: [...editor.querySelectorAll('[data-cat][data-ids]')].flatMap((e) => (e.dataset.ids ? e.dataset.ids.split(' ') : [])),
    hasAnother: [...editor.querySelectorAll('button')].some((b) => b.innerText.includes('换一套')),
    hasWhy: !!editor.querySelector('.rec-why'),
    header: editor.querySelector('.rec-head b')?.innerText,
  }))
  ok(editState.header === '修改这天的穿搭' && !editState.hasAnother, '历史记录进入编辑模式且隐藏换一套', editState.header)
  ok(!editState.hasWhy, '编辑模式不显示推荐理由')
  ok(editState.selected.sort().join() === ['top-a', 'top-b', 'bottom-x', 'shoes-1'].sort().join(), '编辑器选中记录原有衣物', editState.selected.join())
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'history-editor.png'), fullPage: true })

  await page.$eval(`${editSelector} .top-slots`, (slots) => {
    const ids = slots.dataset.ids.split(' ')
    const tops = [...slots.querySelectorAll('.top-slot:not(.add)')]
    tops[ids.indexOf('top-b')]?.querySelector('.ts-rm')?.click()
  })
  const topSelector = `${card} .rec .outfit-card[data-cat="top"][data-ids]`
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.ids === 'top-a', {}, topSelector)
  const addButton = await page.$(`${editSelector} .outfit-card[data-cat="top"] .oc-step[data-act="add"]`)
  if (addButton) {
    await addButton.click()
  } else {
    await page.click(`${editSelector} .top-slots .top-slot.add`)
  }
  await page.waitForSelector(`${editSelector} .outfit-card.open[data-cat="top"] .pick-option`)
  await page.click(`${editSelector} .outfit-card.open[data-cat="top"] .pick-option[data-id="top-c"]`)
  const selectedTopSelector = `${card} .rec [data-cat="top"][data-ids]`
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.ids?.includes('top-c'), {}, selectedTopSelector)
  const selectedForSave = await page.$eval(editSelector, (editor) => [...editor.querySelectorAll('[data-cat][data-ids]')].flatMap((e) => e.dataset.ids.split(' ')))
  ok(selectedForSave.includes('top-a') && selectedForSave.includes('top-c') && !selectedForSave.includes('top-b'), '编辑器已选中 A 和 C 并移除 B', selectedForSave.join())
  await page.click(`${editSelector} textarea.rec-note`)
  await page.keyboard.down('Control')
  await page.keyboard.press('A')
  await page.keyboard.up('Control')
  await page.keyboard.type('新感想')
  const noteForSave = await page.$eval(`${editSelector} textarea.rec-note`, (textarea) => textarea.value)
  ok(noteForSave === '新感想', '编辑器感想已更新', noteForSave)
  await page.$eval(`${editSelector} button.primary`, (button) => button.scrollIntoView({ block: 'center' }))
  await page.click(`${editSelector} button.primary`)
  await page.waitForFunction((selector) => !document.querySelector(selector), {}, editSelector)

  const saved = await page.evaluate(async () => {
    const db = await new Promise((res) => { const q = indexedDB.open('wardrobe'); q.onsuccess = () => res(q.result) })
    const outfit = await new Promise((res) => { const q = db.transaction('outfits').objectStore('outfits').get('past-1'); q.onsuccess = () => res(q.result) })
    const items = await new Promise((res) => { const q = db.transaction('items').objectStore('items').getAll(); q.onsuccess = () => res(q.result) })
    const outfits = await new Promise((res) => { const q = db.transaction('outfits').objectStore('outfits').getAll(); q.onsuccess = () => res(q.result) })
    db.close()
    return { outfit, items: Object.fromEntries(items.map((item) => [item.id, item])), outfits }
  })
  const savedRec = saved.outfit
  ok(savedRec.id === 'past-1' && savedRec.date === pastDate && savedRec.createdAt === 1700000000000, '保存时保留原记录 ID、日期和创建时间')
  ok(savedRec.weather === '12° 阴 · 8~14°C' && savedRec.note === '新感想', '保留历史天气并更新感想', `${savedRec.weather} / ${savedRec.note}`)
  ok(savedRec.itemIds.includes('top-a') && savedRec.itemIds.includes('top-c') && !savedRec.itemIds.includes('top-b'), '保存衣物替换结果', savedRec.itemIds.join())
  ok(saved.items['top-b'].wearCount === 0 && saved.items['top-b'].lastWornAt === undefined, '减掉上衣 B 后穿着次数与时间撤回')
  ok(saved.items['top-c'].wearCount === 1 && saved.items['top-a'].wearCount === 1, '上衣 C +1，未变的上衣 A 不变')
  ok(saved.outfits.length === 1 && saved.outfits[0].date === pastDate, '编辑不新增记录，也没有今天的记录', `${saved.outfits.length} 条`)

  const todayMode = await page.$eval('.page .rec', (editor) => ({
    header: editor.querySelector('.rec-head b')?.innerText,
    hasAnother: [...editor.querySelectorAll('button')].some((b) => b.innerText.includes('换一套')),
  }))
  ok(todayMode.header === '今天穿这套' && todayMode.hasAnother, '今日穿搭仍保持今天模式')
} finally {
  await browser.close()
  server.close()
}

console.log(fail ? `❌ ${fail} 项失败` : '✅ 历史记录编辑 E2E 全部通过')
process.exit(fail ? 1 : 0)
