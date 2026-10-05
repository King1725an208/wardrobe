import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { wearLevel } from '../frequency'
import { CATEGORIES, SEASONS, STYLE_TAGS, WEAR_LEVELS, type Category, type WearLevel } from '../types'
import { useBlobUrl } from '../useBlobUrl'
import type { WardrobeItem } from '../types'

function Card({ item, onOpen }: { item: WardrobeItem; onOpen: (id: string) => void }) {
  const url = useBlobUrl(item.photo)
  const { settings } = useStore()
  const lv = wearLevel(item, settings)
  const lvLabel = WEAR_LEVELS.find((w) => w.key === lv)!
  return (
    <button className="card" onClick={() => onOpen(item.id)}>
      {url ? <img src={url} alt="" /> : <div className="ph" />}
      <div className="card-info">
        <div className="card-title">
          {item.brand || CATEGORIES.find((c) => c.key === item.category)?.label}
        </div>
        <div className="card-sub">
          {item.colors.join('/')} · {item.season}
        </div>
        <span className={`badge lv-${lv}`}>{lvLabel.label}</span>
      </div>
    </button>
  )
}

export default function Wardrobe({ onOpen }: { onOpen: (id: string) => void }) {
  const { items, settings } = useStore()
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [season, setSeason] = useState<string>('all')
  const [style, setStyle] = useState<string>('all')
  const [lv, setLv] = useState<WearLevel | 'all'>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'new' | 'worn' | 'price'>('new')

  const filtered = useMemo(() => {
    let list = items
    if (cat !== 'all') list = list.filter((i) => i.category === cat)
    if (season !== 'all') list = list.filter((i) => i.season === season)
    if (style !== 'all') list = list.filter((i) => i.styles.includes(style))
    if (lv !== 'all') list = list.filter((i) => wearLevel(i, settings) === lv)
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
        <select value={lv} onChange={(e) => setLv(e.target.value as WearLevel | 'all')}>
          <option value="all">常穿度</option>
          {WEAR_LEVELS.map((w) => (
            <option key={w.key} value={w.key}>{w.label}</option>
          ))}
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
