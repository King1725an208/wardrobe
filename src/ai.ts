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

/** 调豆包视觉模型识别衣服属性；无 key 或失败时返回 null（调用方回退手动填写） */
export async function identifyClothing(photo: Blob, s: Settings): Promise<AiGuess | null> {
  if (!s.doubaoApiKey) return null
  const model = s.doubaoModel || 'doubao-vision-pro-32k-241028'
  const image = await blobToDataUrl(photo)
  try {
    const resp = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
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
    if (!resp.ok) return null
    const data = await resp.json()
    const text: string = data?.choices?.[0]?.message?.content ?? ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    const raw = JSON.parse(m[0])
    const guess: AiGuess = {}
    if (VALID_CATEGORIES.includes(raw.category)) guess.category = raw.category
    if (VALID_SEASONS.includes(raw.season)) guess.season = raw.season
    if (Array.isArray(raw.colors)) guess.colors = raw.colors.map(String).slice(0, 3)
    if (Array.isArray(raw.styles)) guess.styles = raw.styles.map(String).slice(0, 3)
    if (raw.brand) guess.brand = String(raw.brand)
    if (raw.material) guess.material = String(raw.material)
    return guess
  } catch {
    return null
  }
}
