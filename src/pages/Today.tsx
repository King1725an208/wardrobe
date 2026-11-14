import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { markWorn, rewearOutfit, unmarkWorn } from '../db'
import { CATEGORIES } from '../types'
import { useBlobUrl } from '../useBlobUrl'
import type { Category, OutfitRecord, WardrobeItem } from '../types'
import { localDate } from '../date'
import { getDayInfo, getWeather, type DayInfo, type Weather } from '../weather'
import WeatherCard from '../components/WeatherCard'
import TodayPick from '../components/TodayPick'
import type { RecCtx } from '../recommend'

const today = () => localDate()

const BREAKDOWN_ORDER: Category[] = [
  'outerwear',
  'top',
  'dress',
  'bottom',
  'shoes',
  'bag',
  'accessory',
]

function BreakdownItem({ item }: { item: WardrobeItem }) {
  const url = useBlobUrl(item.photo)
  return (
    <div className="bd-item">
      {url && <img src={url} alt="" />}
      <span className="badge">
        {CATEGORIES.find((c) => c.key === item.category)?.label}
        {item.brand ? ` · ${item.brand}` : ''}
      </span>
    </div>
  )
}

function OutfitCard({
  rec,
  today,
  editing,
  onEdit,
  editor,
}: {
  rec: OutfitRecord
  today?: boolean
  editing: boolean
  onEdit: () => void
  editor?: ReactNode
}) {
  const url = useBlobUrl(rec.photo)
  const { items } = useStore()
  const [open, setOpen] = useState(false)
  const worn = BREAKDOWN_ORDER.map((cat) => ({
    cat,
    list: rec.itemIds
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is WardrobeItem => !!i && i.category === cat),
  })).filter((g) => g.list.length > 0)
  return (
    <div className="outfit" onClick={() => setOpen(!open)}>
      <div className="outfit-head">
        <span className="outfit-date">{rec.date}{today ? ' · 今天' : ''}</span>
        <span className="muted">{rec.weather ?? ''} {open ? '收起' : '展开拆解'}</span>
        <button type="button" className="outfit-edit" onClick={(e) => { e.stopPropagation(); onEdit() }}>修改</button>
      </div>
      {open ? (
        <div className="breakdown">
          {worn.map((g) => (
            <div key={g.cat} className={`bd-row ${g.list.length > 1 ? 'multi' : ''}`}>
              {g.list.map((it) => <BreakdownItem key={`${g.cat}-${it.id}`} item={it} />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="chips">
          {rec.itemIds.map((id) => {
            const it = items.find((i) => i.id === id)
            return it ? (
              <span key={id} className="badge">
                {it.brand || CATEGORIES.find((c) => c.key === it.category)?.label}
              </span>
            ) : null
          })}
        </div>
      )}
      {url && <img src={url} alt="" />}
      {rec.note && <div className="muted">{rec.note}</div>}
      {editing && <div onClick={(e) => e.stopPropagation()}>{editor}</div>}
    </div>
  )
}

export default function Today() {
  const { outfits, settings, saveOutfit, load } = useStore()
  const existing = outfits.find((o) => o.date === today())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [weather, setWeather] = useState<Weather | null | undefined>()
  const [day, setDay] = useState<DayInfo | undefined>()
  useEffect(() => {
    void getWeather().then(setWeather)
    void getDayInfo().then(setDay)
  }, [])
  const date = today()
  const ctx = useMemo<RecCtx>(() => ({ date, weather, day, outfits, settings }), [date, weather, day, outfits, settings])

  // 照片、衣服、感想、当天天气都存在今天这一条记录里；去掉的衣服撤回今天那次穿着次数
  const save = async (ids: string[], photo: Blob | undefined, note: string) => {
    const rec: OutfitRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      date,
      photo,
      itemIds: ids,
      note: note || undefined,
      // 天气在第一次保存时快照下来，之后改衣服/照片/感想不会被当天的新天气覆盖
      weather: existing?.weather ?? (weather ? `${weather.temp}° ${weather.text} · ${weather.min}~${weather.max}°C${weather.rainy ? ' · 有雨' : ''}${weather.windy ? ' · 风大' : ''}` : undefined),
      createdAt: existing?.createdAt ?? Date.now(),
    }
    await saveOutfit(rec)
    await unmarkWorn(date, (existing?.itemIds ?? []).filter((id) => !ids.includes(id)))
    await markWorn(date, ids)
    await load()
  }
  const saveFor = (rec: OutfitRecord) => async (ids: string[], photo: Blob | undefined, note: string) => {
    await saveOutfit({ ...rec, photo, itemIds: ids, note: note || undefined })
    await rewearOutfit(rec.date, rec.itemIds, ids)
    await load()
  }
  const editRecord = (rec: OutfitRecord) => {
    if (rec.date === date) {
      document.querySelector('.rec')?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    setEditingId((id) => id === rec.id ? null : rec.id)
  }

  return (
    <div className="page">
      <h1>今日穿搭 <span className="muted">{date}</span></h1>
      <WeatherCard weather={weather} day={day} />
      <TodayPick ctx={ctx} existing={existing} onSave={save} />

      <h2>历史记录</h2>
      {outfits.map((o) => (
        <OutfitCard
          key={o.id}
          rec={o}
          today={o.date === date}
          editing={editingId === o.id}
          onEdit={() => editRecord(o)}
          editor={editingId === o.id ? (
            <TodayPick
              key={o.id}
              mode="edit"
              ctx={{ date: o.date, weather: undefined, day: undefined, outfits, settings }}
              existing={o}
              onSave={saveFor(o)}
              onClose={() => setEditingId(null)}
            />
          ) : undefined}
        />
      ))}
    </div>
  )
}
