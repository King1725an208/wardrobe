import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { markWorn, unmarkWorn } from '../db'
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

function OutfitCard({ rec }: { rec: OutfitRecord }) {
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
        <span className="outfit-date">{rec.date}</span>
        <span className="muted">{open ? '收起' : '展开拆解'}</span>
      </div>
      {open ? (
        <div className="breakdown">
          {worn.map((g) =>
            g.list.map((it) => <BreakdownItem key={`${g.cat}-${it.id}`} item={it} />),
          )}
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
    </div>
  )
}

export default function Today() {
  const { outfits, settings, saveOutfit, load } = useStore()
  const existing = outfits.find((o) => o.date === today())
  const [weather, setWeather] = useState<Weather | null | undefined>()
  const [day, setDay] = useState<DayInfo | undefined>()
  useEffect(() => {
    void getWeather().then(setWeather)
    void getDayInfo().then(setDay)
  }, [])
  const date = today()
  const ctx = useMemo<RecCtx>(() => ({ date, weather, day, outfits, settings }), [date, weather, day, outfits, settings])

  // 照片、衣服、一句话都存在今天这一条记录里；去掉的衣服撤回今天那次穿着次数
  const save = async (ids: string[], photo: Blob | undefined, note: string) => {
    const rec: OutfitRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      date,
      photo,
      itemIds: ids,
      note: note || undefined,
      createdAt: existing?.createdAt ?? Date.now(),
    }
    await saveOutfit(rec)
    await unmarkWorn(date, (existing?.itemIds ?? []).filter((id) => !ids.includes(id)))
    await markWorn(date, ids)
    await load()
  }

  return (
    <div className="page">
      <h1>今日穿搭 <span className="muted">{date}</span></h1>
      <WeatherCard weather={weather} day={day} />
      <TodayPick ctx={ctx} existing={existing} onSave={save} />

      <h2>历史记录</h2>
      {outfits.filter((o) => o.date !== date).map((o) => (
        <OutfitCard key={o.id} rec={o} />
      ))}
    </div>
  )
}
