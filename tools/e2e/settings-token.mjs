// 设置页口令输入与旧值修复 E2E
// 先 npm run build，再：CHROME_PATH=... node tools/e2e/settings-token.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = path.join(ROOT, 'dist')
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
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
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) fail++
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto(URL, { waitUntil: 'networkidle0' })

  const openSettings = async () => {
    const settingsTab = await page.$('.tabbar button:nth-child(4)')
    if (settingsTab) await settingsTab.click()
    await page.waitForSelector('.page h1')
  }
  const keyInput = 'input[type="password"]'
  const save = async () => {
    await page.click('.page button.primary')
    await page.waitForSelector('.modal-box button.primary')
    await page.click('.modal-box button.primary')
  }
  const readSettingsRow = () => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('wardrobe')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const row = await new Promise((resolve, reject) => {
      const req = db.transaction('settings').objectStore('settings').get('main')
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return row
  })
  const waitForKey = async (expected) => {
    await page.waitForFunction(async (value) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('wardrobe')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const row = await new Promise((resolve, reject) => {
        const req = db.transaction('settings').objectStore('settings').get('main')
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => reject(req.error)
      })
      db.close()
      return (row?.value?.doubaoApiKey ?? null) === value
    }, {}, expected ?? null)
    return readSettingsRow()
  }

  await openSettings()
  await page.click(keyInput)
  await page.keyboard.type('20160920')
  await save()
  let row = await waitForKey('20160920')
  ok(row?.key === 'main' && row?.value?.doubaoApiKey === '20160920', '新设置按真实 settings/main 结构保存口令', JSON.stringify(row?.value))

  await page.reload({ waitUntil: 'networkidle0' })
  await openSettings()
  ok(await page.$eval(keyInput, (input) => input.value) === 'XXXXXXXXXXXXX', '重新加载后显示脱敏口令')
  await page.click(keyInput)
  await page.keyboard.type('20160920')
  await save()
  row = await waitForKey('20160920')
  ok(row?.value?.doubaoApiKey === '20160920', '点入口令直接输入后仍只保存新口令')

  await page.reload({ waitUntil: 'networkidle0' })
  await openSettings()
  await page.click(keyInput)
  await page.click('.page h1')
  await page.waitForFunction((selector) => document.querySelector(selector)?.value === 'XXXXXXXXXXXXX', {}, keyInput)
  await save()
  row = await waitForKey('20160920')
  ok(row?.value?.doubaoApiKey === '20160920', '仅聚焦再离开保留已存口令')

  await page.click(keyInput)
  await page.keyboard.type(' ２０１６０９２０ ')
  await save()
  row = await waitForKey('20160920')
  ok(row?.value?.doubaoApiKey === '20160920', '保存时去空白并将全角数字规范化')

  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('wardrobe')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const row = await new Promise((resolve, reject) => {
      const req = db.transaction('settings').objectStore('settings').get('main')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    row.value.doubaoApiKey = 'XXXXXXXXXXXXX20160920'
    await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite')
      tx.objectStore('settings').put(row)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await openSettings()
  row = await waitForKey('20160920')
  ok(row?.value?.doubaoApiKey === '20160920', '加载时修复并持久化旧版前缀污染的口令')

  const clearButton = await page.waitForSelector('xpath/.//button[contains(., "清除口令")]')
  await clearButton.click()
  ok(await page.$eval(keyInput, (input) => input.value) === '', '清除操作后口令框保持为空')
  await save()
  row = await waitForKey(null)
  ok(row?.value?.doubaoApiKey === undefined, '确认清除口令后保存为 undefined')
} finally {
  await browser.close()
  server.close()
}

if (fail) process.exitCode = 1
else console.log('✅ 口令设置 E2E 全部通过')
