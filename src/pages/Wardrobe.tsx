import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { wearLevel } from '../frequency'
import {
  CATEGORIES, MATERIALS, SEASONS, STANDARD_COLORS, STYLE_TAGS, WEAR_LEVELS,
  type Category, type WearLevel,
} from '../types'
import { useBlobUrl } from '../useBlobUrl'
import type { WardrobeItem } from '../types'

type TagKey = 'category' | 'season' | 'color' | 'style' | 'material' | 'wear'

function Card({ item, onOpen }: { item: WardrobeItem; onOpen: (id: string) => void }) {
  const url = useBlobUrl(item.photo)
  const { settings, update } = useStore()
  const [open, setOpen] = useState<TagKey | null>(null)
  const lv = wearLevel(item, settings)
  const lvLabel = lv ? WEAR_LEVELS.find((w) => w.key === lv)!.label : '没定义'
  const catLabel = CATEGORIES.find((c) => c.key === item.category)?.label ?? item.category

  const set = (p: Partial<WardrobeItem>) => update({ ...item, ...p })
  const pick = (k: TagKey) => setOpen((o) => (o === k ? null : k))
  const tag = (k: TagKey, label: string, cls = '') => (
    <button key={`${k}:${label}`} className={`tag ${cls} ${open === k ? 'on' : ''}`} onClick={() => pick(k)}>
      {label}
    </button>
  )
  // 颜色/风格可多选：点选项切换，下拉保持展开
  const toggleArr = (key: 'colors' | 'styles', v: string) => {
    const arr = item[key]
    set({ [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] } as Partial<WardrobeItem>)
  }
  // 单选类：选中即更新并收起
  const choose = (p: Partial<WardrobeItem>) => () => { set(p); setOpen(null) }

  return (
    <div className="card">
      <button className="card-img" onClick={() => onOpen(item.id)}>
        {url ? <img src={url} alt="" /> : <div className="ph" />}
      </button>
      <div className="card-info">
        <div className="card-title" onClick={() => onOpen(item.id)}>
          {item.brand || catLabel}
        </div>
        <div className="tags">
          {tag('category', catLabel)}
          {tag('season', item.season)}
          {item.colors.length ? item.colors.map((c) => tag('color', c)) : tag('color', '＋颜色', 'tag-add')}
          {item.styles.length ? item.styles.map((s) => tag('style', s)) : tag('style', '＋风格', 'tag-add')}
          {item.material ? tag('material', item.material) : tag('material', '＋材质', 'tag-add')}
          {tag('wear', lvLabel, `lv-${lv ?? 'none'}`)}
        </div>

        {open === 'category' && (
          <div className="tag-drop chips">
            {CATEGORIES.map((c) => (
              <button key={c.key} className={item.category === c.key ? 'on' : ''} onClick={choose({ category: c.key })}>
                {c.label}
              </button>
            ))}
          </div>
        )}
        {open === 'season' && (
          <div className="tag-drop chips">
            {SEASONS.map((s) => (
              <button key={s} className={item.season === s ? 'on' : ''} onClick={choose({ season: s })}>
                {s}
              </button>
            ))}
          </div>
        )}
        {open === 'color' && (
          <div className="tag-drop chips">
            {STANDARD_COLORS.map((c) => (
              <button key={c} className={item.colors.includes(c) ? 'on' : ''} onClick={() => toggleArr('colors', c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        {open === 'style' && (
          <div className="tag-drop chips">
            {STYLE_TAGS.map((s) => (
              <button key={s} className={item.styles.includes(s) ? 'on' : ''} onClick={() => toggleArr('styles', s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {open === 'material' && (
          <div className="tag-drop chips">
            {MATERIALS.map((m) => (
              <button key={m} className={item.material === m ? 'on' : ''}
                onClick={choose({ material: item.material === m ? undefined : m })}>
                {m}
              </button>
            ))}
          </div>
        )}
        {open === 'wear' && (
          <div className="tag-drop chips">
            <button className={!item.manualWearLevel ? 'on' : ''} onClick={choose({ manualWearLevel: undefined })}>
              自动
            </button>
            {WEAR_LEVELS.map((w) => (
              <button key={w.key} className={item.manualWearLevel === w.key ? 'on' : ''} onClick={choose({ manualWearLevel: w.key })}>
                {w.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Wardrobe({ onOpen }: { onOpen: (id: string) => void }) {
  const { items, settings } = useStore()
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [season, setSeason] = useState<string>('all')
  const [style, setStyle] = useState<string>('all')
  const [lv, setLv] = useState<WearLevel | 'all' | 'none'>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'new' | 'worn' | 'price'>('new')

  const filtered = useMemo(() => {
    let list = items
    if (cat !== 'all') list = list.filter((i) => i.category === cat)
    if (season !== 'all') list = list.filter((i) => i.season === season)
    if (style !== 'all') list = list.filter((i) => i.styles.includes(style))
    if (lv === 'none') list = list.filter((i) => wearLevel(i, settings) === undefined)
    else if (lv !== 'all') list = list.filter((i) => wearLevel(i, settings) === lv)
    if (q.trim()) {
      const k = q.trim().toLowerCase()
      list = list.filter(
        (i) =>
          i.brand?.toLowerCase().includes(k) ||
          i.note?.toLowerCase().includes(k) ||
          i.colors.some((c) => c.includes(k))
      )
    }
    return [...list].sort((a, b) => {
      if (sort === 'worn') return (b.lastWornAt ?? 0) - (a.lastWornAt ?? 0)
      if (sort === 'price') return (b.price ?? 0) - (a.price ?? 0)
      return b.createdAt - a.createdAt
    })
  }, [items, cat, season, style, lv, q, sort, settings])

  return (
    <div className="page">
      <h1>我的衣柜 <span className="muted">{items.length} 件</span></h1>
      <input className="search" placeholder="搜索品牌/备注/颜色" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="cats">
        <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>全部</button>
        {CATEGORIES.map((c) => (
          <button key={c.key} className={cat === c.key ? 'on' : ''} onClick={() => setCat(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="filters">
        <select value={season} onChange={(e) => setSeason(e.target.value)}>
          <option value="all">季节</option>
          {SEASONS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="all">风格</option>
          {STYLE_TAGS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={lv} onChange={(e) => setLv(e.target.value as WearLevel | 'all' | 'none')}>
          <option value="all">常穿度</option>
          {WEAR_LEVELS.map((w) => (
            <option key={w.key} value={w.key}>{w.label}</option>
          ))}
          <option value="none">没定义</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="new">最近录入</option>
          <option value="worn">最近穿过</option>
          <option value="price">价格</option>
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="muted center-pad">还没有衣服，点底部「＋录入」拍一件吧</p>
      ) : (
        <div className="grid">
          {filtered.map((i) => (
            <Card key={i.id} item={i} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}
