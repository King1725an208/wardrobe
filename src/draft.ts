import type { Category, Season, WardrobeItem } from './types'
import type { AiGuess } from './ai'

/** 录入/编辑共用的表单草稿（全部字符串，方便绑定输入框） */
export interface Draft {
  category: Category
  brand: string
  purchasedAt: string
  price: string
  colors: string
  styles: string[]
  season: Season
  material: string
  note: string
}

export function emptyDraft(): Draft {
  return {
    category: 'top',
    brand: '',
    purchasedAt: '',
    price: '',
    colors: '',
    styles: [],
    season: '春秋',
    material: '',
    note: '',
  }
}

export function draftFromItem(i: WardrobeItem): Draft {
  return {
    category: i.category,
    brand: i.brand ?? '',
    purchasedAt: i.purchasedAt ?? '',
    price: i.price != null ? String(i.price) : '',
    colors: i.colors.join(' '),
    styles: i.styles,
    season: i.season,
    material: i.material ?? '',
    note: i.note ?? '',
  }
}

export function applyGuess(d: Draft, g: AiGuess): Draft {
  return {
    ...d,
    category: g.category ?? d.category,
    season: g.season ?? d.season,
    colors: g.colors?.length ? g.colors.join(' ') : d.colors,
    styles: g.styles?.length ? g.styles : d.styles,
    brand: g.brand || d.brand,
    material: g.material || d.material,
  }
}

/** 草稿转成可写入数据库的字段 */
export function draftToFields(d: Draft) {
  return {
    category: d.category,
    brand: d.brand.trim() || undefined,
    purchasedAt: d.purchasedAt || undefined,
    price: d.price ? Number(d.price) : undefined,
    colors: d.colors.split(/[\s,，/、]+/).filter(Boolean),
    styles: d.styles,
    season: d.season,
    material: d.material.trim() || undefined,
    note: d.note.trim() || undefined,
  }
}
