export type Category =
  | 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'bag' | 'accessory'

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'top', label: '上衣' },
  { key: 'bottom', label: '下装' },
  { key: 'dress', label: '连衣裙' },
  { key: 'outerwear', label: '外套' },
  { key: 'shoes', label: '鞋' },
  { key: 'bag', label: '包' },
  { key: 'accessory', label: '配饰' },
]

export const SEASONS = ['夏', '春秋', '冬'] as const
export type Season = (typeof SEASONS)[number]

export const STYLE_TAGS = ['通勤', '休闲', '运动', '甜美', '正式', '度假'] as const

export type WearLevel = 'often' | 'rarely' | 'never'

export const WEAR_LEVELS: { key: WearLevel; label: string }[] = [
  { key: 'often', label: '经常穿' },
  { key: 'rarely', label: '不经常' },
  { key: 'never', label: '从不穿' },
]

export interface WardrobeItem {
  id: string
  photo: Blob
  originalPhoto?: Blob // 去背景前的原图
  category: Category
  brand?: string
  purchasedAt?: string // YYYY-MM
  price?: number
  colors: string[]
  styles: string[]
  season: Season
  material?: string
  size?: string
  note?: string
  createdAt: number
  lastWornAt?: number
  wearCount: number
  manualWearLevel?: WearLevel
  // 预留云同步字段
  userId?: string
  syncedAt?: number
}

export type NewItem = Omit<WardrobeItem, 'id' | 'createdAt' | 'wearCount'>

export interface OutfitRecord {
  id: string
  date: string // YYYY-MM-DD
  photo?: Blob
  itemIds: string[]
  note?: string
  createdAt: number
  userId?: string
  syncedAt?: number
}

export const THEMES = [
  { key: 'forest', label: '苔绿森林' },
  { key: 'cream', label: '奶油花园' },
  { key: 'mint', label: '薄荷雾蓝' },
] as const
export type Theme = (typeof THEMES)[number]['key']

export interface Settings {
  theme?: Theme // 默认 forest
  doubaoApiKey?: string
  doubaoModel?: string // 默认 doubao-seed-2.1-turbo
  aiProxyUrl?: string // 留空用默认代理
  removeBg?: boolean // 录入时用 Seedream 去背景（默认开）
  bgModel?: string // 默认 doubao-seedream-5-0-pro
  oftenDays?: number // 默认 90
  oftenCount?: number // 默认 3
  rarelyDays?: number // 默认 180
  neverDays?: number // 默认 365
}
