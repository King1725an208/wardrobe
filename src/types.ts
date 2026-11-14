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

/** 子类（按保暖程度）：category → 子类 key → 中文名 / 保暖分（1薄 ~ 3厚，越大越保暖；无 = 0） */
export const SUBTYPES: Partial<Record<Category, { key: string; label: string; warm: number }[]>> = {
  top: [
    { key: 'tee_polo', label: '短袖 T恤/Polo', warm: 1 },
    { key: 'shirt', label: '衬衣', warm: 1 },
    { key: 'long_tee', label: '长袖 T恤', warm: 2 },
    { key: 'hoodie', label: '长袖卫衣', warm: 2 },
    { key: 'knit', label: '长袖毛衣', warm: 3 },
    { key: 'fleece', label: '抓绒/内胆', warm: 3 },
    { key: 'other_long', label: '其他长袖', warm: 2 },
  ],
  bottom: [
    { key: 'shorts', label: '短裤', warm: 1 },
    { key: 'long_thin', label: '长裤（薄）', warm: 1 },
    { key: 'long_thick', label: '长裤（厚）', warm: 2 },
    { key: 'skirt', label: '半身裙', warm: 1 },
  ],
  outerwear: [
    { key: 'thin', label: '薄外套', warm: 1 },
    { key: 'shell', label: '功能外套', warm: 1 },
    { key: 'thick', label: '厚外套', warm: 2 },
  ],
  dress: [
    { key: 'short', label: '短袖/无袖', warm: 1 },
    { key: 'long', label: '长袖', warm: 2 },
    { key: 'knit', label: '针织/毛衣裙', warm: 3 },
  ],
  shoes: [
    { key: 'sport', label: '运动鞋', warm: 1 },
    { key: 'casual', label: '休闲鞋', warm: 1 },
    { key: 'boots', label: '靴子', warm: 3 },
    { key: 'sandal', label: '凉鞋/拖鞋', warm: 0 },
  ],
  bag: [
    { key: 'commute', label: '通勤', warm: 0 },
    { key: 'casual', label: '休闲', warm: 0 },
    { key: 'travel', label: '度假', warm: 0 },
  ],
  accessory: [{ key: 'hat', label: '帽子', warm: 0 }, { key: 'scarf', label: '围巾/披肩', warm: 1 }, { key: 'belt', label: '腰带', warm: 0 }, { key: 'glasses', label: '眼镜', warm: 0 }, { key: 'other', label: '其他', warm: 0 }],
}

export const subtypeLabel = (category: Category, key?: string) => {
  if (!key) return ''
  return SUBTYPES[category]?.find((s) => s.key === key)?.label ?? ''
}
/** 保暖分：子类没填时按季节兜底（冬=2、夏=1、春秋=1） */
export function warmth(item: Pick<WardrobeItem, 'category' | 'subtype' | 'season'>): number {
  const s = item.subtype ? SUBTYPES[item.category]?.find((x) => x.key === item.subtype) : undefined
  if (s) return s.warm
  if (item.category === 'outerwear') return 2
  if (item.category === 'bag' || item.category === 'accessory') return 0
  return item.season === '冬' ? 2 : 1
}

export const STYLE_TAGS = ['通勤', '休闲', '运动', '甜美', '正式', '度假'] as const

/** 与 AI 识别提示词约定的标准色表（ai.ts 校验过滤、衣柜页颜色快捷选项共用） */
export const STANDARD_COLORS = [
  '黑', '白', '米白', '米黄', '灰', '卡其', '驼色', '咖啡', '藏青', '浅蓝',
  '牛仔蓝', '粉', '玫红', '红', '酒红', '橙', '黄', '浅绿', '墨绿', '紫', '花色',
]

/** 常见材质（衣柜页材质 tag 的快捷选项；材质字段本身仍是自由文本） */
export const MATERIALS = ['棉', '麻', '丝', '羊毛', '羊绒', '针织', '牛仔', '皮革', '涤纶', '尼龙', '雪纺', '混纺']

/** 大众品牌（表单快捷选项；品牌字段本身仍是自由文本，可手动输入其他品牌） */
export const BRANDS = [
  '优衣库', 'ZARA', 'H&M', 'UR', 'MUJI', 'GAP',
  '太平鸟', '森马', '美特斯邦威', '海澜之家', '波司登', 'GXG', '杰克琼斯', 'ONLY', 'VERO MODA', '乐町',
  '李宁', '安踏', '耐克', '阿迪达斯', 'New Balance', '斯凯奇', '匡威', 'Vans',
]

/** 价格区间（chips 快选时写入区间中间值，仍可手动输入精确价格） */
export const PRICE_RANGES = [
  { label: '100以内', min: 0, max: 99, mid: 80 },
  { label: '100-300', min: 100, max: 299, mid: 200 },
  { label: '300-500', min: 300, max: 499, mid: 400 },
  { label: '500-1000', min: 500, max: 999, mid: 750 },
  { label: '1000-2000', min: 1000, max: 1999, mid: 1500 },
  { label: '2000以上', min: 2000, max: Infinity, mid: 2500 },
]

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
  subtype?: string // 子类 key（见 SUBTYPES），旧数据为空
  brand?: string
  purchasedAt?: string // 购买年份 YYYY（旧数据可能是 YYYY-MM）
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
  note?: string // 感想/一句话
  weather?: string // 记录当天的天气快照（存时的天气，之后不变）
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

export type Stage = 'idle' | 'loading' | 'done' | 'failed'

/** 录入页的每张待保存照片（持久化到 IDB addQueue，切页/刷新/杀掉 App 都不丢） */
export interface AddEntry {
  key: string
  photo: Blob
  cutout?: Blob
  useCutout: boolean
  bg: Stage
  bgError: string
  ai: Stage
  aiError: string
  draft: import('./draft').Draft
  dupOf?: string // 录入查重命中：衣柜中某件的 id；与本批另一张照片重复时为 'batch'
}

/** AddEntry 在 IDB addQueue 里的存储行（多一个排序序号） */
export interface AddQueueRow extends AddEntry {
  seq: number
}

/**
 * 「先存后补」的后台抠图任务（IDB bgTasks）：
 * 保存时白底图还没好 → 衣物先以原图入库，任务落盘；
 * App 打开期间用并发池尽力跑，好了自动换主图；杀掉/刷新后下次打开续跑。
 */
export interface BgTask {
  itemId: string
  photo?: Blob // 待抠的原图；kind='ai' 的识图任务不存图（运行时读衣物主图），避免重复占存储
  kind?: 'bg' | 'ai' // 默认 bg：补抠白底图；ai：AI 识别属性
  mode?: 'fill' | 'overwrite' // 仅 kind='ai'：fill=只填空字段（默认）；overwrite=覆盖已有识别字段（分类/季节/颜色/风格/材质/品牌）
  tries: number // 已失败次数（≥3 放弃）
  createdAt: number
  lastError?: string
}

export interface Settings {
  theme?: Theme // 默认 forest
  doubaoApiKey?: string
  doubaoModel?: string // 默认 doubao-seed-2.1-pro（turbo 即将下线）
  aiProxyUrl?: string // 留空用默认代理
  removeBg?: boolean // 录入时用 Seedream 去背景（默认开）
  bgModel?: string // 默认 doubao-seedream-5-0-pro
  oftenDays?: number // 默认 90
  oftenCount?: number // 默认 3
  rarelyDays?: number // 默认 180
  neverDays?: number // 默认 365
  autoBackup?: boolean // 改动后自动云备份（默认开，需已填口令）
  cutoutNorm?: boolean // 存量白底图已统一画幅（一次性整理标记，见 store.normalizeExistingCutouts）
}
