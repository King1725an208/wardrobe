import { useRef, useState } from 'react'
import { useStore } from '../store'
import { markWorn } from '../db'
import { CATEGORIES } from '../types'
import { useBlobUrl } from '../useBlobUrl'
import type { OutfitRecord } from '../types'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function OutfitCard({ rec }: { rec: OutfitRecord }) {
  const url = useBlobUrl(rec.photo)
  const { items } = useStore()
  return (
    <div className="outfit">
      <div className="outfit-date">{rec.date}</div>
      {url && <img src={url} alt="" />}
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
      {rec.note && <div className="muted">{rec.note}</div>}
    </div>
  )
}

export default function Today() {
  const { outfits, items, saveOutfit, load } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const existing = outfits.find((o) => o.date === today())
  const [photo, setPhoto] = useState<Blob | undefined>(existing?.photo)
  const [picked, setPicked] = useState<string[]>(existing?.itemIds ?? [])
  const [note, setNote] = useState(existing?.note ?? '')
  const url = useBlobUrl(photo)

  const toggle = (id: string) =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])

  const save = async () => {
    const rec: OutfitRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      date: today(),
      photo,
      itemIds: picked,
      note: note || undefined,
      createdAt: existing?.createdAt ?? Date.now(),
    }
    await saveOutfit(rec)
    await markWorn(rec.date, picked)
    await load()
    alert('已记录今天的穿搭 ✓')
  }

  return (
    <div className="page">
      <h1>今日穿搭 <span className="muted">{today()}</span></h1>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="user"
        hidden
        onChange={(e) => setPhoto(e.target.files?.[0])}
      />
      {url ? (
        <img className="preview" src={url} alt="" onClick={() => fileRef.current?.click()} />
      ) : (
        <button className="photo-btn" onClick={() => fileRef.current?.click()}>
          🤳 拍一张今天的穿搭
        </button>
      )}

      <label>今天穿了衣柜里的哪几件？</label>
      <div className="pick-grid">
        {items.map((i) => (
          <PickThumb key={i.id} id={i.id} picked={picked.includes(i.id)} onToggle={toggle} />
        ))}
      </div>

      <label>一句话</label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="今天去…" />
      <button className="primary" onClick={save}>
        {existing ? '更新今日记录' : '记录今天'}
      </button>

      <h2>历史记录</h2>
      {outfits.filter((o) => o.date !== today()).map((o) => (
        <OutfitCard key={o.id} rec={o} />
      ))}
    </div>
  )
}

function PickThumb({
  id,
  picked,
  onToggle,
}: {
  id: string
  picked: boolean
  onToggle: (id: string) => void
}) {
  const { items } = useStore()
  const item = items.find((i) => i.id === id)
  const url = useBlobUrl(item?.photo)
  if (!item) return null
  return (
    <button className={`thumb ${picked ? 'on' : ''}`} onClick={() => onToggle(id)}>
      {url && <img src={url} alt="" />}
    </button>
  )
}
