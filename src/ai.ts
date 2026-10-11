import { STANDARD_COLORS, STYLE_TAGS, type Category, type Season, type Settings } from './types'

export interface AiGuess {
  category?: Category
  colors?: string[]
  styles?: string[]
  season?: Season
  brand?: string
  material?: string
}

const VALID_CATEGORIES: Category[] = [
  'top',
  'bottom',
  'dress',
  'outerwear',
  'shoes',
  'bag',
  'accessory',
]
const VALID_SEASONS: Season[] = ['夏', '春秋', '冬']

/** 默认识别模型（doubao-seed-2.1-turbo 即将下线；pro 视觉理解更准、实测更快） */
const DEFAULT_MODEL = 'doubao-seed-2.1-pro'

/** 识别提示词：标准色表 + 风格定义 + 忽略背景 + 连衣裙/下装辨析 + few-shot 示例 */
const IDENTIFY_PROMPT = `你是电子衣柜的服装录入助手。照片里是一件待录入的衣物（可能挂在衣架或门后），请忽略背景（门、衣架、地板、人等），只描述衣物本身。只输出一个 JSON 对象，不要输出任何其他文字、解释或 markdown。

JSON 字段：
- category: 只能取 top/bottom/dress/outerwear/shoes/bag/accessory。辨析：有肩带、袖子或上半身结构的连体裙选 dress；只有腰头、从腰部开始的半身裙或裤子选 bottom；开衫等外搭选 outerwear
- colors: 衣物本身的颜色，按面积占比从大到小，最多3个；只能从标准色表中选：黑、白、米白、米黄、灰、卡其、驼色、咖啡、藏青、浅蓝、牛仔蓝、粉、玫红、红、酒红、橙、黄、浅绿、墨绿、紫、花色。多色印花/拼接时主色在前，"花色"放最后。
- styles: 从以下6个标签中选最符合的1-2个：通勤（简洁利落适合上班）、休闲（日常随意）、运动（运动品牌/功能面料/为运动设计）、甜美（浅柔色系、女性化细节）、正式（正装礼服）、度假（鲜艳印花、宽松沙滩感）
- season: 夏/春秋/冬，按面料厚薄和袖长判断：短袖薄款=夏；长袖、针织、卫衣、薄外套=春秋；厚毛衣、羽绒、加绒=冬
- brand: 看清 logo 才填，否则空字符串
- material: 看得出材质才填（棉/羊毛/针织/牛仔/雪纺/尼龙/皮革等），否则空字符串

输出示例：{"category":"outerwear","colors":["黑"],"styles":["运动"],"season":"春秋","brand":"Under Armour","material":"尼龙"}`

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

/** 浏览器直连方舟会被 CORS 拦截，所以经中转转发（中转不保存 key）。
 *  默认内置火山引擎 API 网关自建的透传中转——国内手机/电脑可直连，开箱即用。 */
export const DEFAULT_AI_PROXY =
  'https://s541k7nhsr3s4fusd2e8k.apigateway-cn-beijing.volceapi.com/api/plan/v3'

function proxyBase(s: Settings): string {
  const base = (s.aiProxyUrl || DEFAULT_AI_PROXY).trim().replace(/\/$/, '')
  if (!base) throw new Error('请先在「设置」页填写 AI 中转地址')
  return base
}

/**
 * 拼方舟接口地址。两种中转形态：
 * - 火山 API 网关（路径已含 /api/plan/v3，直透方舟）→ 直接拼路径
 * - 旧版自建中转（FastAPI / Cloudflare Worker，约定 /ark 前缀转发）→ 拼 /ark + 路径
 */
function arkUrl(base: string, path: '/chat/completions' | '/images/generations'): string {
  return base.endsWith('/v3') ? `${base}${path}` : `${base}/ark${path}`
}

/** 调豆包视觉模型识别衣服属性；无 key 返回 null，失败抛出带中文说明的 Error */
export async function identifyClothing(photo: Blob, s: Settings): Promise<AiGuess | null> {
  if (!s.doubaoApiKey) return null
  const model = s.doubaoModel || DEFAULT_MODEL
  const base = proxyBase(s)
  const image = await blobToDataUrl(photo)
  let resp: Response
  try {
    resp = await fetch(arkUrl(base, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${s.doubaoApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: IDENTIFY_PROMPT,
              },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      }),
    })
  } catch {
    throw new Error('网络请求失败（无法连接 AI 代理）')
  }
  if (!resp.ok) {
    let detail = ''
    try {
      const j = await resp.json()
      detail = j?.error?.message || j?.error || ''
    } catch {
      /* ignore */
    }
    if (resp.status === 401) throw new Error('API Key 无效或没权限' + (detail ? `：${detail}` : ''))
    throw new Error(`AI 接口返回 ${resp.status}` + (detail ? `：${detail}` : ''))
  }
  const data = await resp.json()
  const text: string = data?.choices?.[0]?.message?.content ?? ''
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('AI 没有返回可解析的结果')
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(m[0])
  } catch {
    throw new Error('AI 返回的结果格式不对')
  }
  {
    // 白名单校验：非法 category/season 丢弃；styles/colors 过滤到约定词表，
    // 防止模型自由发挥（如"浅裸粉色"）导致筛选器和标签体系失效
    const guess: AiGuess = {}
    if (VALID_CATEGORIES.includes(raw.category as Category)) guess.category = raw.category as Category
    if (VALID_SEASONS.includes(raw.season as Season)) guess.season = raw.season as Season
    if (Array.isArray(raw.colors)) {
      const rawColors = raw.colors.map(String)
      const standard = rawColors.filter((c) => STANDARD_COLORS.includes(c))
      // 全都不在色表时保留原值兜底（颜色在衣柜里是自由文本，有总比没有强）
      guess.colors = (standard.length ? standard : rawColors).slice(0, 3)
    }
    if (Array.isArray(raw.styles)) {
      const valid = raw.styles.map(String).filter((t) => (STYLE_TAGS as readonly string[]).includes(t))
      guess.styles = valid.slice(0, 2)
    }
    if (raw.brand) guess.brand = String(raw.brand)
    if (raw.material) guess.material = String(raw.material)
    return guess
  }
}

/** 用 Seedream 把衣服抠到纯白背景上；返回新的图片 Blob */
export async function removeBackground(photo: Blob, s: Settings): Promise<Blob> {
  if (!s.doubaoApiKey) throw new Error('未填写 API Key')
  const base = proxyBase(s)
  const image = await blobToDataUrl(photo)
  let resp: Response
  try {
    resp = await fetch(arkUrl(base, '/images/generations'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${s.doubaoApiKey}`,
      },
      body: JSON.stringify({
        model: s.bgModel || 'doubao-seedream-5-0-pro',
        prompt: '去掉背景，只保留这件衣物/鞋/包，平铺放在纯白色背景正中，保持款式、颜色、细节完全不变，不要添加任何东西',
        image,
        response_format: 'b64_json',
        size: '1K',
        watermark: false,
      }),
    })
  } catch {
    throw new Error('网络请求失败（无法连接 AI 代理）')
  }
  if (!resp.ok) {
    let detail = ''
    try {
      const j = await resp.json()
      detail = j?.error?.message || ''
    } catch {
      /* ignore */
    }
    throw new Error(`去背景接口返回 ${resp.status}` + (detail ? `：${detail}` : ''))
  }
  const data = await resp.json()
  const b64: string | undefined = data?.data?.[0]?.b64_json
  if (!b64) throw new Error('去背景没有返回图片')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'image/jpeg' })
}
