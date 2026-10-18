/**
 * 去背景（images/generations）速度与成本基准测试
 *
 * 回答的问题：
 *  A 归因：一次去背景 ≈1 分钟里，链路 RTT / 上传 / 方舟生成 各占多少？
 *  B 输入尺寸：压缩输入（长边 1024/1600 vs 模拟原图）能省多少上传时间？生成时间是否不变？
 *  C 输出参数：size 1K vs 2K、response_format b64_json vs url 的耗时差？
 *  D 换模型：账号上还有哪些图像生成/编辑模型可用？谁更快？（输出图存档供人工质量对比）
 *  另：每次调用记录响应里的 usage 字段 → 验证图像生成计费是否与输入 token 相关。
 *
 * 用法：
 *   node tools/bench/bg-speed.mjs                 # 全部阶段（1→2→3），断点续跑
 *   node tools/bench/bg-speed.mjs --stage 2       # 只跑某阶段（0 总是先跑：热身+鉴权+模型清单探测）
 *   node tools/bench/bg-speed.mjs --reps 3        # 每格重复次数（默认 2，取中位数）
 *   node tools/bench/bg-speed.mjs --img 137       # 只跑文件名含 137 的图
 *   node tools/bench/bg-speed.mjs --models a,b    # 覆盖 stage2 候选模型列表
 * 结果：控制台表格 + tools/bench/bench-out/report-bg.json + bench-out/img/*.jpg
 * 断点续跑：已成功的格子自动跳过；想重跑就删掉 report-bg.json。
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const parent = path.resolve(root, '..')
const PIC_DIR = path.join(parent, 'Wardrobe pic')
const OUT_DIR = path.join(root, 'tools', 'bench', 'bench-out')
const IMG_DIR = path.join(OUT_DIR, 'img')
const REPORT = path.join(OUT_DIR, 'report-bg.json')
mkdirSync(IMG_DIR, { recursive: true })

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt
}
const REPS = Number(opt('reps', '2'))
const STAGE = opt('stage', '') // '' = 全部
const CHROME = opt('chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')

// 链路：默认直连方舟 /api/plan/v3（ark-key.txt 里的方舟 Key 可用；App 走的网关透传到同一表面）。
// 网关需 APP_TOKEN（存在 vefaas 函数环境变量里，仓库中没有）——拿到后用
//   --proxy https://s541k7nhsr3s4fusd2e8k.apigateway-cn-beijing.volceapi.com/api/plan/v3 --key <口令>
// 复跑即可测「网关比直连慢多少」的对照格。
const PROXY = opt('proxy', 'https://ark.cn-beijing.volces.com/api/plan/v3').replace(/\/+$/, '')
const genUrl = `${PROXY}/images/generations`
const chatUrl = `${PROXY}/chat/completions`
const DIRECT_GEN = 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations' // 直连对照（report.json 显示同 key 直连通过）
const KEY = opt('key', '') || process.env.ARK_KEY ||
  (existsSync(path.join(parent, 'ark-key.txt')) ? readFileSync(path.join(parent, 'ark-key.txt'), 'utf8').trim() : '')

// 与 src/ai.ts removeBackground 一字不差
const BG_MODEL = 'doubao-seedream-5-0-pro'
const BG_PROMPT = '去掉背景，只保留这件衣物/鞋/包，平铺放在纯白色背景正中，保持款式、颜色、细节完全不变，不要添加任何东西'
const CHAT_MODEL = 'doubao-seed-2.1-pro'

// stage2 候选模型（探测账号可用性；错误信息原样打印）
const MODEL_CANDIDATES = opt('models', '')
  ? opt('models', '').split(',').map((s) => s.trim()).filter(Boolean)
  : ['doubao-seedream-5-0', 'doubao-seedream-4-5', 'doubao-seedream-4-0-250828', 'doubao-seededit-3-0-i2i-250628']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// —— 断点续跑：report-bg.json 作为结果池 ——
const pool = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : { cells: {} }
const done = (key) => pool.cells[key]?.status === 200
const record = (key, cell) => {
  pool.cells[key] = { ...cell, at: new Date().toISOString() }
  writeFileSync(REPORT, JSON.stringify(pool, null, 2))
}
/** 链路 RTT 估计：最小 chat 调用（含 ≤1s 模型时间，作为上界） */
async function ping() {
  const t0 = Date.now()
  try {
    const r = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: CHAT_MODEL, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: '只回复 ok' }] }),
      signal: AbortSignal.timeout(30_000),
    })
    await r.text()
    return { secs: (Date.now() - t0) / 1000, status: r.status }
  } catch (e) {
    return { secs: (Date.now() - t0) / 1000, status: 0, err: e.message }
  }
}

/** 一次去背景调用；返回 {secs,status,usage,b64KB,dlSecs,file,err} */
async function callGen(dataUrl, { model = BG_MODEL, size = '1K', fmt = 'b64_json', url = genUrl, tag = '' } = {}) {
  const t0 = Date.now()
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model, prompt: BG_PROMPT, image: dataUrl, response_format: fmt, size, watermark: false }),
      signal: AbortSignal.timeout(240_000),
    })
  } catch (e) {
    return { secs: (Date.now() - t0) / 1000, status: 0, err: `网络错误: ${e.message}` }
  }
  const secs = (Date.now() - t0) / 1000
  const body = await resp.text()
  if (!resp.ok) return { secs, status: resp.status, err: body.slice(0, 400) }
  let j
  try {
    j = JSON.parse(body)
  } catch {
    return { secs, status: resp.status, err: `响应非 JSON: ${body.slice(0, 200)}` }
  }
  const item = j?.data?.[0] ?? {}
  const out = { secs, status: resp.status, usage: j.usage ?? null }
  if (item.b64_json) {
    const buf = Buffer.from(item.b64_json, 'base64')
    out.b64KB = Math.round(buf.length / 1024)
    if (tag) {
      writeFileSync(path.join(IMG_DIR, `${tag}.jpg`), buf)
      out.file = `${tag}.jpg`
    }
  } else if (item.url) {
    out.imgUrlHost = new URL(item.url).host
    // 顺带测回源下载耗时（App 若用 url 格式就要走这段）
    const d0 = Date.now()
    try {
      const dl = await fetch(item.url, { signal: AbortSignal.timeout(20_000) })
      const ab = await dl.arrayBuffer()
      out.dlSecs = (Date.now() - d0) / 1000
      out.b64KB = Math.round(ab.byteLength / 1024)
    } catch (e) {
      out.dlErr = e.message
    }
  } else {
    out.err = `无图返回: ${body.slice(0, 200)}`
  }
  return out
}

/** 与 App 同技术栈的尺寸变体（canvas JPEG），另加 3024px 升采样模拟手机原图 */
async function makeVariants(page, imgPath, specs) {
  const b64 = readFileSync(imgPath).toString('base64')
  return page.evaluate(async (b64, specs) => {
    const src = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]))
    const out = {}
    for (const { label, edge, q } of specs) {
      const scale = edge / Math.max(src.width, src.height)
      const w = Math.round(src.width * scale)
      const h = Math.round(src.height * scale)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d').drawImage(src, 0, 0, w, h)
      const jb = await new Promise((r) => c.toBlob(r, 'image/jpeg', q))
      const dataUrl = await new Promise((r) => {
        const fr = new FileReader()
        fr.onload = () => r(fr.result)
        fr.readAsDataURL(jb)
      })
      out[label] = { w, h, dataUrl, KB: Math.round((dataUrl.length * 3) / 4 / 1024) }
    }
    src.close()
    return out
  }, b64, specs)
}

const fmtCell = (c) =>
  c.status === 200
    ? `${c.secs.toFixed(1)}s${c.dlSecs != null ? `+回源${c.dlSecs.toFixed(1)}s` : ''} 出图${c.b64KB ?? '?'}KB${c.usage ? ` usage=${JSON.stringify(c.usage)}` : ''}`
    : `❌ HTTP ${c.status} ${(c.err ?? '').slice(0, 120)}`
// —— 测试图片：默认连衣裙 134 / 外套 137 / 上衣 139 三张代表图 ——
let pics = readdirSync(PIC_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
const only = opt('img', '')
if (only) pics = pics.filter((f) => f === only || f.includes(only))
else pics = pics.filter((f) => ['134', '137', '139'].some((k) => f.includes(k)))
if (!pics.length) {
  console.error('❌ 没找到测试图片')
  process.exit(1)
}
const p137 = pics.find((f) => f.includes('137')) ?? pics[0]

if (!KEY) {
  console.error('❌ 没有 API Key（ark-key.txt / ARK_KEY / --key）')
  process.exit(1)
}
if (!existsSync(CHROME)) {
  console.error(`❌ 没找到 Chrome: ${CHROME}（可用 --chrome 指定）`)
  process.exit(1)
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })

try {
  const page = await browser.newPage()
  await page.goto('about:blank')

  // ===== Stage 0：热身 + 鉴权 + RTT + 模型清单探测 =====
  const p0 = await ping()
  console.log(`链路 ping（RTT 上界）: HTTP ${p0.status} ${p0.secs.toFixed(1)}s`)
  if (p0.status === 401) {
    console.error('❌ Key 无效，停止')
    process.exit(1)
  }
  for (const u of [`${PROXY}/models`]) {
    try {
      const r = await fetch(u, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15_000) })
      const t = await r.text()
      console.log(`GET ${new URL(u).host}${new URL(u).pathname} → HTTP ${r.status}${r.ok ? ' 模型数: ' + (JSON.parse(t)?.data?.length ?? '?') : ' ' + t.slice(0, 80)}`)
      if (r.ok) writeFileSync(path.join(OUT_DIR, 'models-list.json'), t)
    } catch (e) {
      console.log(`GET models(${new URL(u).host}) → ${e.message}`)
    }
  }

  const runStage = (n) => !STAGE || STAGE === String(n)

  // ===== Stage 1（A+B+C）：基线模型 × 输入尺寸 × 输出参数（用 137 外套）=====
  if (runStage(1)) {
    console.log(`\n===== Stage 1 归因+输入尺寸+输出参数（${BG_MODEL}，${p137}）=====`)
    const variants = await makeVariants(page, path.join(PIC_DIR, p137), [
      { label: 'big3024', edge: 3024, q: 0.95 }, // 升采样模拟手机原图（上传段外推用）
      { label: 'e1600', edge: 1600, q: 0.85 },
      { label: 'e1024', edge: 1024, q: 0.85 },
    ])
    for (const [label, v] of Object.entries(variants)) {
      console.log(`■ 输入 ${label} ${v.w}x${v.h} ${v.KB}KB`)
      const pg = await ping()
      for (let r = 0; r < REPS; r++) {
        const key = `${p137}|${BG_MODEL}|1K|b64|${label}|r${r}`
        if (done(key)) {
          console.log(`  r${r}: 跳过（已完成）`)
          continue
        }
        const c = await callGen(v.dataUrl, { tag: r === 0 ? `s1_${label}` : '' })
        record(key, { ...c, ping: pg.secs, inKB: v.KB, dim: `${v.w}x${v.h}` })
        console.log(`  r${r}: ${fmtCell(c)}  [ping ${pg.secs.toFixed(1)}s]`)
        await sleep(500)
      }
    }
    // 参数对照：2K 与 url 格式（1024 输入，各 1 发）
    for (const [label, over] of [['size2K', { size: '2K' }], ['fmtUrl', { fmt: 'url' }]]) {
      const key = `${p137}|${BG_MODEL}|${label}|x|e1024|r0`
      if (!done(key)) {
        const c = await callGen(variants.e1024.dataUrl, { ...over, tag: `s1_${label}` })
        record(key, { ...c, inKB: variants.e1024.KB })
        console.log(`■ ${label}: ${fmtCell(c)}`)
      }
    }
    // 直连方舟对照（网关开销 ≈ 网关耗时 - 直连耗时），1024 输入 1 发；默认直连跑时无意义，跳过
    const dk = `${p137}|${BG_MODEL}|direct|x|e1024|r0`
    if (!PROXY.includes('ark.cn-beijing.volces.com') && !done(dk)) {
      const c = await callGen(variants.e1024.dataUrl, { url: DIRECT_GEN })
      record(dk, { ...c, inKB: variants.e1024.KB })
      console.log(`■ 直连对照: ${fmtCell(c)}`)
    }
  }
  // ===== Stage 2（D 探测）：候选模型可用性 + 单发耗时（137，1024 输入）=====
  const usable = []
  if (runStage(2)) {
    console.log(`\n===== Stage 2 候选模型探测（1024 输入，各 1 发）=====`)
    const variants = await makeVariants(page, path.join(PIC_DIR, p137), [{ label: 'e1024', edge: 1024, q: 0.85 }])
    for (const m of MODEL_CANDIDATES) {
      const key = `${p137}|${m}|probe|x|e1024|r0`
      let c = pool.cells[key]
      if (!done(key)) {
        const tag = `s2_${m.replaceAll('.', '-').replaceAll('_', '-')}`
        c = await callGen(variants.e1024.dataUrl, { model: m, tag })
        record(key, { ...c, model: m, inKB: variants.e1024.KB })
      }
      console.log(`  ${m}: ${fmtCell(c)}`)
      if (c.status === 200) usable.push(m)
      await sleep(500)
    }
  } else {
    for (const [k, c] of Object.entries(pool.cells)) if (k.includes('|probe|') && c.status === 200) usable.push(k.split('|')[1])
  }

  // ===== Stage 3（D 实测）：可用替代模型 × 3 图 × reps（1024 输入）=====
  if (runStage(3) && usable.length) {
    console.log(`\n===== Stage 3 替代模型实测（${usable.join(' / ')}）=====`)
    for (const m of usable) {
      for (const f of pics) {
        const variants = await makeVariants(page, path.join(PIC_DIR, f), [{ label: 'e1024', edge: 1024, q: 0.85 }])
        const runs = []
        for (let r = 0; r < REPS; r++) {
          const key = `${f}|${m}|1K|b64|e1024|r${r}`
          if (done(key)) {
            runs.push(pool.cells[key].secs)
            continue
          }
          const num = f.match(/(\d{3})/)?.[1] ?? f.slice(0, 8)
          const tag = r === 0 ? `s3_${m.replaceAll('.', '-').replaceAll('_', '-')}_${num}` : ''
          const c = await callGen(variants.e1024.dataUrl, { model: m, tag })
          record(key, { ...c, model: m, inKB: variants.e1024.KB })
          console.log(`  ${m} ${num} r${r}: ${fmtCell(c)}`)
          if (c.status === 200) runs.push(c.secs)
          await sleep(500)
        }
        if (runs.length) console.log(`  → ${m} ${f} 中位 ${median(runs).toFixed(1)}s`)
      }
    }
  } else if (runStage(3)) {
    console.log('\n===== Stage 3 跳过：没有可用的替代模型 =====')
  }

  // ===== 汇总表 =====
  console.log('\n========== 汇总（中位秒数；≈生成 = 总耗时 - ping 上界）==========')
  const groups = {}
  for (const [k, c] of Object.entries(pool.cells)) {
    if (c.status !== 200 || c.secs == null) continue
    const [, m, size, fmt, edge] = k.split('|')
    const g = (groups[`${m} | ${size} | ${fmt} | ${edge}`] ??= { secs: [], pings: [], inKB: c.inKB, outKB: c.b64KB, usage: c.usage })
    g.secs.push(c.secs)
    if (c.ping) g.pings.push(c.ping)
  }
  for (const [g, v] of Object.entries(groups)) {
    const gen = median(v.secs) - (v.pings.length ? median(v.pings) : 0)
    console.log(`${g}\n   n=${v.secs.length}  总${median(v.secs).toFixed(1)}s  ≈生成${gen.toFixed(1)}s  入${v.inKB ?? '?'}KB→出${v.outKB ?? '?'}KB${v.usage ? `  usage=${JSON.stringify(v.usage)}` : ''}`)
  }
  console.log(`\n明细: ${REPORT}\n图片: ${IMG_DIR}`)
} finally {
  await browser.close()
}



