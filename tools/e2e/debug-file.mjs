/**
 * 单文件上传诊断（本地调试用）：把用户报错的文件走一遍真实上传流程，
 * 打印弹窗里的失败原因和页面 console 输出，用于复现「读不出来」的根因。
 *
 * 用法：npm run build 后执行  node tools/e2e/debug-file.mjs <文件路径>
 * 注意：诊断的文件不要提交进仓库（可能含个人隐私照片）。
 */
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dist = path.join(root, 'dist')
const target = process.argv[2]
if (!target || !existsSync(target) || !statSync(target).isFile()) {
  console.error('用法: node tools/e2e/debug-file.mjs <文件路径>')
  process.exit(1)
}
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ 不存在，先 npm run build')
  process.exit(1)
}

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

const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (!p.startsWith('/wardrobe/')) {
    res.writeHead(404)
    return res.end('not found')
  }
  const rel = p.slice('/wardrobe/'.length) || 'index.html'
  let file = path.join(dist, rel)
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html')
  }
  const body = await readFile(file)
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  res.end(body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
console.log(`本地伺服: http://127.0.0.1:${port}/wardrobe/  诊断文件: ${target}`)

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
  page.on('console', async (m) => {
    if (m.type() === 'debug') return
    const parts = await Promise.all(
      m.args().map(async (a) => {
        try {
          return JSON.stringify(await a.jsonValue())
        } catch {
          return a.toString()
        }
      }),
    )
    console.log(`  [页面 ${m.type()}]`, parts.join(' ') || m.text())
  })
  page.on('pageerror', (e) => console.log('  [页面异常]', e.message))

  await page.goto(`http://127.0.0.1:${port}/wardrobe/`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForSelector('nav.tabbar', { timeout: 15000 })
  await page.evaluate(() => [...document.querySelectorAll('nav.tabbar button')].find((b) => b.textContent.includes('录入'))?.click())
  const input = await page.waitForSelector('input[type="file"][multiple]', { timeout: 10000 })

  const dialogP = new Promise((r) => (dialogHit = r))
  await input.uploadFile(path.resolve(target))
  let result
  try {
    result = await Promise.race([
      page
        // 单文件没有缩略图条（多选才渲染 .thumb），成功标志 = 预览图解码就绪
        .waitForFunction(() => document.querySelector('img.preview')?.naturalWidth > 0, { timeout: 120000, polling: 2000 })
        .then(() => 'ok'),
      dialogP.then(() => 'dialog'),
    ])
  } catch (e) {
    const state = await page
      .evaluate(() => ({
        thumbs: document.querySelectorAll('.thumb').length,
        preview: !!document.querySelector('img.preview'),
        bodyText: document.body.innerText.slice(0, 300),
      }))
      .catch((err) => ({ evalError: String(err) }))
    console.log('\n⏱ 等待缩略图超时，页面状态:', JSON.stringify(state, null, 2))
    throw e
  }

  if (dialogs.length > 0) {
    console.log('\n❌ 弹窗内容（这就是用户看到的失败原因）:')
    for (const d of dialogs) console.log('   ', d)
  }
  if (result === 'ok') {
    const info = await page.evaluate(async () => {
      const img = document.querySelector('img.preview')
      const blob = await (await fetch(img.src)).blob()
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768))
      return { type: blob.type, size: blob.size, w: img.naturalWidth, h: img.naturalHeight, b64: btoa(bin) }
    })
    const out = path.join(tmpdir(), 'wardrobe-e2e', 'decoded-preview.jpg')
    await mkdir(path.dirname(out), { recursive: true })
    await writeFile(out, Buffer.from(info.b64, 'base64'))
    console.log(`\n✅ 上传成功: ${info.w}x${info.h}, ${info.type}, ${info.size}B`)
    console.log(`解码结果已保存（人工核对用）: ${out}`)
  } else {
    console.log(`\n❌ 未进入待保存列表（result=${result}）`)
    process.exitCode = 1
  }
} finally {
  await browser.close()
  server.close()
}
