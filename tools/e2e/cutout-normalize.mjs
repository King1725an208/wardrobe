/**
 * 去背景统一画幅（本地裁边居中）端到端测试（真实 Chrome，无头模式）
 *
 * 场景：存量衣服的白底图是 Seedream 早期生成结果——衣服大小/位置/留白不一。
 * App 启动时一次性本地整理（不花 token）：裁掉四周近白留白、居中、等比缩放到 1024²，
 * 内容最长边占 84%，保证衣柜格子里所有衣服显示大小一致。完成后 settings.cutoutNorm=true 不再跑。
 *
 * 断言：
 * 1) 整理后图片为 1024×1024，衣服包围盒居中（中心 ≈ 512,512）；
 * 2) 衣服本体最长边占画布约 75%（裁边含 6% 边距后按 84% 缩放，各衣服比例一致）；
 * 3) 没有 originalPhoto 的衣服（未去背景/手动图）不受影响；
 * 4) 幂等：再打开页面不重复整理（图片字节不变）。
 *
 * 用法：npm run build && CHROME_PATH=... node tools/e2e/cutout-normalize.mjs
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

await new Promise((r) => staticServer.listen(0, '127.0.0.1', r))
const appUrl = `http://127.0.0.1:${staticServer.address().port}/wardrobe/`

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })

// ---------- 往 IDB 塞：1 件「白底但衣服偏小偏角」的已去背景衣服 + 1 件未去背景 ----------
await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
await page.evaluate(async () => {
  // 模拟 Seedream 早期结果：800×800 白底，衣服（蓝色块）只占中间一小块且偏右下
  const messy = await new Promise((res) => {
    const c = document.createElement('canvas')
    c.width = c.height = 800
    const g = c.getContext('2d')
    g.fillStyle = '#fff'; g.fillRect(0, 0, 800, 800)
    g.fillStyle = '#247'; g.fillRect(480, 420, 220, 260) // 衣服偏小、偏右下
    c.toBlob(res, 'image/png')
  })
  const plain = await new Promise((res) => {
    const c = document.createElement('canvas')
    c.width = c.height = 400
    const g = c.getContext('2d')
    g.fillStyle = '#eee'; g.fillRect(0, 0, 400, 400)
    g.fillStyle = '#f80'; g.fillRect(100, 100, 200, 200)
    c.toBlob(res, 'image/png')
  })
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('wardrobe')
    q.onsuccess = () => res(q.result)
    q.onerror = () => rej(q.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction(['items', 'settings'], 'readwrite')
    tx.objectStore('items').put({
      id: 'norm-1', photo: messy, originalPhoto: plain,
      category: 'top', season: '春秋', colors: [], styles: [],
      createdAt: Date.now(), wearCount: 0,
    })
    tx.objectStore('items').put({
      id: 'norm-2', photo: plain, // 无 originalPhoto：未去背景，不该被整理
      category: 'shoes', season: '夏', colors: [], styles: [],
      createdAt: Date.now(), wearCount: 0,
    })
    tx.objectStore('settings').put({ key: 'main', value: {} })
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  db.close()
})

const readState = () =>
  page.evaluate(async () => {
    const db = await new Promise((res) => { const q = indexedDB.open('wardrobe'); q.onsuccess = () => res(q.result) })
    const tx = db.transaction(['items', 'settings'])
    const get = (store, key) => new Promise((res) => { const q = tx.objectStore(store).get(key); q.onsuccess = () => res(q.result) })
    const [s1, s2, settings] = await Promise.all([get('items', 'norm-1'), get('items', 'norm-2'), get('settings', 'main')])
    db.close()
    return {
      p1: s1?.photo?.size ?? 0,
      o1: s1?.originalPhoto?.size ?? 0,
      p2: s2?.photo?.size ?? 0,
      cutoutNorm: !!settings?.value?.cutoutNorm,
    }
  })

// ---------- 刷新触发 load() → 一次性整理 ----------
await page.reload({ waitUntil: 'networkidle0' })
const before = await readState()

// 等整理完成（settings.cutoutNorm=true）
const deadline = Date.now() + 20000
let st = before
while (Date.now() < deadline) {
  st = await readState()
  if (st.cutoutNorm) break
  await new Promise((r) => setTimeout(r, 300))
}
check('一次性整理完成并打标记', st.cutoutNorm)
check('原图备份 originalPhoto 未被动', st.o1 === before.o1, `${before.o1} → ${st.o1}`)
check('未去背景的衣服不受影响', st.p2 === before.p2, `${before.p2} → ${st.p2}`)

// ---------- 校验归一化效果：1024²、内容居中、最长边约 84% ----------
const geo = await page.evaluate(async () => {
  const db = await new Promise((res) => { const q = indexedDB.open('wardrobe'); q.onsuccess = () => res(q.result) })
  const item = await new Promise((res) => { const q = db.transaction('items').objectStore('items').get('norm-1'); q.onsuccess = () => res(q.result) })
  db.close()
  const bmp = await createImageBitmap(item.photo)
  const cv = document.createElement('canvas')
  cv.width = bmp.width
  cv.height = bmp.height
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0)
  const { width: sw, height: sh } = cv
  const { data } = ctx.getImageData(0, 0, sw, sh)
  let minX = sw, minY = sh, maxX = -1, maxY = -1
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4
      const isBg = data[i + 3] < 24 || (data[i] > 246 && data[i + 1] > 246 && data[i + 2] > 246)
      if (isBg) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  bmp.close()
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  return {
    size: `${sw}×${sh}`,
    centerX: ((minX + maxX) / 2).toFixed(1),
    centerY: ((minY + maxY) / 2).toFixed(1),
    maxSide: Math.max(w, h),
    ratio: (Math.max(w, h) / sw).toFixed(3),
  }
})
check('输出为 1024×1024 正方形', geo.size === '1024×1024', geo.size)
check('衣服居中（中心 ≈ 512,512）', Math.abs(geo.centerX - 512) < 30 && Math.abs(geo.centerY - 512) < 30, `(${geo.centerX}, ${geo.centerY})`)
check('衣服本体最长边占画布约 75%（各衣服比例一致）', Number(geo.ratio) > 0.7 && Number(geo.ratio) < 0.8, `ratio=${geo.ratio} maxSide=${geo.maxSide}`)

// ---------- 幂等：再打开不重复整理 ----------
await page.reload({ waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 2000))
const after = await readState()
check('再打开不重复整理（标记已打）', after.cutoutNorm && after.p1 === st.p1, `photo ${st.p1} → ${after.p1}`)

await browser.close()
staticServer.close()
const failed = checks.filter((c) => !c.ok).length
console.log(failed ? `❌ ${failed} 项失败` : '✅ 去背景统一画幅 E2E 全部通过')
process.exit(failed ? 1 : 0)
