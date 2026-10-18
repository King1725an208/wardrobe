/**
 * AI 识别速度基准测试：图片尺寸 × 延迟 × 准确率 矩阵
 *
 * 回答的问题：发给豆包视觉模型的图压到多小，既不掉识别准确率，又能省多少时间/ token？
 * 方法：真实浏览器把原图缩成各档（与 App 压缩路径同技术：createImageBitmap + canvas JPEG），
 *       走与 App 完全相同的中转链路调用，记录 耗时 / usage.prompt_tokens / 识别结果。
 *
 * 用法：
 *   node tools/bench/ai-speed.mjs                 # 3 张代表图 × 尺寸档 × 3 次
 *   node tools/bench/ai-speed.mjs --img 137       # 只跑文件名含 137 的图
 *   node tools/bench/ai-speed.mjs --img D:\xx.jpg # 绝对路径也行
 *   node tools/bench/ai-speed.mjs --all           # Wardrobe pic 全部图（调用多，注意额度）
 *   node tools/bench/ai-speed.mjs --reps 5        # 每档重复次数（默认 3，取中位数）
 * 结果：控制台表格 + tools/bench/bench-out/report.json
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const parent = path.resolve(root, '..')
const PIC_DIR = path.join(parent, 'Wardrobe pic')
const OUT_DIR = path.join(root, 'tools', 'bench', 'bench-out')
mkdirSync(OUT_DIR, { recursive: true })

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt
}
const has = (name) => args.includes(name.startsWith('--') ? name : '--' + name)
const REPS = Number(opt('reps', '3'))
const DETAIL = opt('detail', '') // ''=默认(auto) / low / high，全局加到 image_url
const THINK = opt('think', '') // ''=默认 / disabled / enabled / auto → body.thinking

// 与 App 完全相同的中转链路（src/ai.ts DEFAULT_AI_PROXY）
const PROXY = opt('proxy', 'https://s541k7nhsr3s4fusd2e8k.apigateway-cn-beijing.volceapi.com/api/plan/v3').replace(/\/+$/, '')
const chatUrl = PROXY.endsWith('/v3') ? `${PROXY}/chat/completions` : `${PROXY}/ark/chat/completions`
const MODEL = opt('model', 'doubao-seed-2.1-pro')
const KEY = opt('key', '') || process.env.ARK_KEY ||
  (existsSync(path.join(parent, 'ark-key.txt')) ? readFileSync(path.join(parent, 'ark-key.txt'), 'utf8').trim() : '')

// 与 src/ai.ts IDENTIFY_PROMPT 一字不差
const PROMPT = `你是电子衣柜的服装录入助手。照片里是一件待录入的衣物（可能挂在衣架或门后），请忽略背景（门、衣架、地板、人等），只描述衣物本身。只输出一个 JSON 对象，不要输出任何其他文字、解释或 markdown。

JSON 字段：
- category: 只能取 top/bottom/dress/outerwear/shoes/bag/accessory。辨析：有肩带、袖子或上半身结构的连体裙选 dress；只有腰头、从腰部开始的半身裙或裤子选 bottom；开衫等外搭选 outerwear
- colors: 衣物本身的颜色，按面积占比从大到小，最多3个；只能从标准色表中选：黑、白、米白、米黄、灰、卡其、驼色、咖啡、藏青、浅蓝、牛仔蓝、粉、玫红、红、酒红、橙、黄、浅绿、墨绿、紫、花色。多色印花/拼接时主色在前，"花色"放最后。
- styles: 从以下6个标签中选最符合的1-2个：通勤（简洁利落适合上班）、休闲（日常随意）、运动（运动品牌/功能面料/为运动设计）、甜美（浅柔色系、女性化细节）、正式（正装礼服）、度假（鲜艳印花、宽松沙滩感）
- season: 夏/春秋/冬，按面料厚薄和袖长判断：短袖薄款=夏；长袖、针织、卫衣、薄外套=春秋；厚毛衣、羽绒、加绒=冬
- brand: 看清 logo 才填，否则空字符串
- material: 看得出材质才填（棉/羊毛/针织/牛仔/雪纺/尼龙/皮革等），否则空字符串

输出示例：{"category":"outerwear","colors":["黑"],"styles":["运动"],"season":"春秋","brand":"Under Armour","material":"尼龙"}`

// 尺寸档（长边 px）。336=12×28，对齐视觉模型常见 28×28 patch 网格；--edges 1024,512 可缩减
const EDGES = opt('edges', '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n >= 64 && n <= 4096)
const EDGES_FINAL = EDGES.length ? EDGES : [1280, 1024, 768, 512, 336]
const JPEG_Q = 0.85

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** 一次调用：返回 {secs, status, usage, guess|null, err|null} */
async function callArk(dataUrl, { detail = DETAIL } = {}) {
  const t0 = Date.now()
  let resp
  try {
    resp = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        ...(THINK ? { thinking: { type: THINK } } : {}),
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: detail ? { url: dataUrl, detail } : { url: dataUrl } },
          ],
        }],
      }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    return { secs: (Date.now() - t0) / 1000, status: 0, usage: null, guess: null, err: e.message }
  }
  const secs = (Date.now() - t0) / 1000
  const body = await resp.text()
  if (!resp.ok) return { secs, status: resp.status, usage: null, guess: null, err: body.slice(0, 200) }
  let j
  try {
    j = JSON.parse(body)
  } catch {
    return { secs, status: resp.status, usage: null, guess: null, err: '响应非JSON' }
  }
  const text = j?.choices?.[0]?.message?.content ?? ''
  const m = text.match(/\{[\s\S]*\}/)
  let guess = null
  try {
    guess = m ? JSON.parse(m[0]) : null
  } catch { /* 保持 null */ }
  return { secs, status: resp.status, usage: j.usage ?? null, guess, err: guess ? null : text.slice(0, 120) }
}

/** 两个识别结果逐字段一致性：返回 {exact: 命中数, total: 比较字段数} */
function agreement(a, b) {
  if (!a || !b) return { exact: 0, total: 6 }
  const eqArr = (x, y) => JSON.stringify(x ?? []) === JSON.stringify(y ?? [])
  const fields = [
    a.category === b.category,
    eqArr(a.colors, b.colors),
    eqArr(a.styles, b.styles),
    a.season === b.season,
    String(a.brand ?? '') === String(b.brand ?? ''),
    String(a.material ?? '') === String(b.material ?? ''),
  ]
  return { exact: fields.filter(Boolean).length, total: 6 }
}

const fmtGuess = (g) =>
  g ? `${g.category ?? '?'}|${(g.colors ?? []).join('/')}|${(g.styles ?? []).join('/')}|${g.season ?? '?'}|${g.brand ?? ''}|${g.material ?? ''}` : '✘'

// ==== 主流程 ====

if (!KEY) {
  console.error('❌ 没有 API Key（ark-key.txt / ARK_KEY / --key）')
  process.exit(1)
}

// 选图：默认 3 张代表——小米转换图（2048 链路实物）、137（带 logo 测 brand 敏感度）、132（易误判的无袖裙）
function pickImages() {
  const only = opt('img', '')
  if (only && path.isAbsolute(only) && existsSync(only)) return [only]
  let files = readdirSync(PIC_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => path.join(PIC_DIR, f))
  if (only) files = files.filter((f) => path.basename(f).includes(only))
  else if (!has('all')) files = files.filter((f) => /_(132|137)_/.test(f))
  const tmpDecoded = path.join(tmpdir(), 'wardrobe-e2e', 'decoded-preview.jpg')
  if (!only && !has('all') && existsSync(tmpDecoded)) files.unshift(tmpDecoded)
  return files
}

const images = pickImages()
if (!images.length) {
  console.error('❌ 没找到测试图片')
  process.exit(1)
}
console.log(`链路: ${chatUrl}\n模型: ${MODEL}  detail: ${DETAIL || 'auto(默认)'}\n图片: ${images.map((p) => path.basename(p)).join(', ')}\n每档重复: ${REPS} 次\n`)

const chromePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find((p) => existsSync(p))
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] })

/** 浏览器内生成各尺寸档（与 App 压缩同技术），返回 {edge: {w,h,dataUrl}} */
async function makeVariants(page, filePath) {
  const b64 = readFileSync(filePath).toString('base64')
  return page.evaluate(async (b64in, edges, q) => {
    const blob = await (await fetch('data:image/jpeg;base64,' + b64in)).blob()
    const src = await createImageBitmap(blob)
    const out = {}
    for (const E of edges) {
      const scale = Math.min(1, E / Math.max(src.width, src.height))
      if (scale >= 1) continue // 原图已不大于此档
      const w = Math.round(src.width * scale)
      const h = Math.round(src.height * scale)
      const bmp = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d').drawImage(bmp, 0, 0)
      const jb = await new Promise((r) => c.toBlob(r, 'image/jpeg', q))
      const dataUrl = await new Promise((r) => {
        const fr = new FileReader()
        fr.onload = () => r(fr.result)
        fr.readAsDataURL(jb)
      })
      out[E] = { w, h, dataUrl }
      bmp.close()
    }
    src.close()
    return out
  }, b64, EDGES_FINAL, JPEG_Q)
}

try {
  const page = await browser.newPage()
  await page.goto('about:blank')

  // 全局热身：64px 白图调一次，预热连接/端点（不计入统计）
  const warm = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const jb = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))
    return new Promise((r) => {
      const fr = new FileReader()
      fr.onload = () => r(fr.result)
      fr.readAsDataURL(jb)
    })
  })
  const w0 = await callArk(warm)
  console.log(`热身调用: HTTP ${w0.status} ${w0.secs.toFixed(1)}s${w0.err ? ' ⚠️ ' + w0.err : ''}\n`)
  if (w0.status === 401) {
    console.error('❌ Key 无效，停止')
    process.exit(1)
  }

  const report = { model: MODEL, chatUrl, reps: REPS, images: [] }

  for (const imgPath of images) {
    const name = path.basename(imgPath)
    const origBuf = readFileSync(imgPath)
    const origUrl = 'data:image/jpeg;base64,' + origBuf.toString('base64')
    const variants = await makeVariants(page, imgPath)
    const cfgs = [{ label: 'orig', dataUrl: origUrl, bytes: origBuf.length, dim: '原始' }]
    for (const [e, v] of Object.entries(variants)) {
      cfgs.push({ label: e, dataUrl: v.dataUrl, bytes: Math.round((v.dataUrl.length * 3) / 4), dim: `${v.w}x${v.h}` })
    }
    console.log(`■ ${name}（原始 ${(origBuf.length / 1024).toFixed(0)}KB）`)

    const rows = []
    let base = null
    for (const cfg of cfgs) {
      const runs = []
      let guess = null
      let usage = null
      for (let r = 0; r < REPS; r++) {
        const res = await callArk(cfg.dataUrl)
        if (res.status === 200 && res.guess) {
          runs.push(res.secs)
          guess = res.guess
          usage = res.usage
        } else {
          console.log(`  [${cfg.label}] 第${r + 1}次失败: HTTP ${res.status} ${res.err ?? ''}`)
        }
        await sleep(400)
      }
      if (!runs.length) {
        rows.push({ cfg: cfg.label, err: '全部失败' })
        continue
      }
      const med = median(runs)
      if (cfg.label === 'orig') base = { med, guess }
      const ag = base && cfg.label !== 'orig' ? agreement(base.guess, guess) : null
      rows.push({ cfg: cfg.label, dim: cfg.dim, KB: Math.round(cfg.bytes / 1024), med, min: Math.min(...runs), tokens: usage?.prompt_tokens ?? null, ctokens: usage?.completion_tokens ?? null, guess, agree: ag?.exact ?? null })
      console.log(
        `  ${cfg.label.padStart(5)} ${String(rows.at(-1).KB).padStart(4)}KB  ${med.toFixed(1)}s(最快${Math.min(...runs).toFixed(1)})  tok=${usage?.prompt_tokens ?? '?'}/${usage?.completion_tokens ?? '?'}${ag ? `  一致${ag.exact}/6` : ''}  ${fmtGuess(guess)}`
      )
    }
    report.images.push({ name, rows })
    console.log()
  }

  // 附加探针：与全局 detail 相反的一档（用第一张图的 1024 档，1 发）
  const v1024 = (await makeVariants(page, images[0]))['1024']
  if (v1024) {
    console.log('— 附加探针 —')
    const probeDetail = DETAIL === 'low' ? 'high' : 'low'
    const d = await callArk(v1024.dataUrl, { detail: probeDetail })
    console.log(`detail=${probeDetail}: HTTP ${d.status} ${d.secs.toFixed(1)}s tok=${d.usage?.prompt_tokens ?? '?'} ${d.err ? '⚠️ ' + d.err : fmtGuess(d.guess)}`)
  }

  const outFile = path.join(OUT_DIR, 'report.json')
  writeFileSync(outFile, JSON.stringify(report, null, 2))
  console.log(`\n明细已存: ${outFile}`)
} finally {
  await browser.close()
}
