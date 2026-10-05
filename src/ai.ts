import type { Category, Season, Settings } from './types'

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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

/** 浏览器直连方舟会被 CORS 拦截，所以经由我们自己的代理转发（代理不保存 key） */
export const DEFAULT_AI_PROXY = '__AI_PROXY_URL__'

/** 调豆包视觉模型识别衣服属性；无 key 返回 null，失败抛出带中文说明的 Error */
export async function identifyClothing(photo: Blob, s: Settings): Promise<AiGuess | null> {
  if (!s.doubaoApiKey) return null
  const model = s.doubaoModel || 'doubao-seed-2.1-turbo'
  const base = (s.aiProxyUrl || DEFAULT_AI_PROXY).replace(/\/$/, '')
  const image = await blobToDataUrl(photo)
  let resp: Response
  try {
    resp = await fetch(`${base}/ark/chat/completions`, {
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
                text: `这是一件衣服的照片。请只输出 JSON（不要其他文字），字段：category(取值 top/bottom/dress/outerwear/shoes/bag/accessory)、colors(中文颜色数组)、styles(从 通勤/休闲/运动/甜美/正式/度假 里选)、season(夏/春秋/冬)、brand(看得出才填)、material(看得出才填)。`,
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
    const guess: AiGuess = {}
    if (VALID_CATEGORIES.includes(raw.category as Category)) guess.category = raw.category as Category
    if (VALID_SEASONS.includes(raw.season as Season)) guess.season = raw.season as Season
    if (Array.isArray(raw.colors)) guess.colors = raw.colors.map(String).slice(0, 3)
    if (Array.isArray(raw.styles)) guess.styles = raw.styles.map(String).slice(0, 3)
    if (raw.brand) guess.brand = String(raw.brand)
    if (raw.material) guess.material = String(raw.material)
    return guess
  }
}

/** 用 Seedream 把衣服抠到纯白背景上；返回新的图片 Blob */
export async function removeBackground(photo: Blob, s: Settings): Promise<Blob> {
  if (!s.doubaoApiKey) throw new Error('未填写 API Key')
  const base = (s.aiProxyUrl || DEFAULT_AI_PROXY).replace(/\/$/, '')
  const image = await blobToDataUrl(photo)
  let resp: Response
  try {
    resp = await fetch(`${base}/ark/images/generations`, {
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
