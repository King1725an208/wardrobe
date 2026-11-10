import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useBlobUrl } from '../useBlobUrl'
import { wearLevel } from '../frequency'
import { normalizePhotoFile } from '../photoFile'
import { CATEGORIES, SUBTYPES, WEAR_LEVELS } from '../types'
import type { Category, OutfitRecord, WardrobeItem } from '../types'
import { compose, missingHint, rank, reasonsFor, recIds, SLOT_ORDER, type Rec, type RecCtx, type Slot } from '../recommend'

const ROWS: Category[] = ['outerwear', 'top', 'dress', 'bottom', 'shoes', 'bag', 'accessory']
const label = (c: Category) => CATEGORIES.find((x) => x.key === c)?.label ?? c

function Tile({ item, on, onTap }: { item: WardrobeItem; on: boolean; onTap: (it: WardrobeItem) => void }) {
  const url = useBlobUrl(item.photo)
  const { settings } = useStore()
  const lv = wearLevel(item, settings)
  // 方案A：桌面悬停 / 手机长按 0.5s 显示品牌+备注，方便认照片
  const [tip, setTip] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasTip = !!(item.brand || item.note)
  const startPress = () => {
    if (!hasTip) return
    timer.current = setTimeout(() => setTip(true), 500)
  }
  const endPress = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }
  return (
    <button
      className={`rec-tile ${on ? 'on' : ''}`} data-id={item.id} data-cat={item.category}
      onClick={() => onTap(item)}
      onMouseEnter={() => hasTip && setTip(true)}
      onMouseLeave={() => setTip(false)}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchMove={endPress}
      onTouchCancel={endPress}
    >
      {url && <img src={url} alt="" />}
      {on && <span className="tick">✓</span>}
      {lv && lv !== 'often' && <span className={`badge lv-${lv}`}>{WEAR_LEVELS.find((w) => w.key === lv)?.label}</span>}
      {tip && hasTip && (
        <span className="tile-tip" onClick={(e) => e.stopPropagation()}>
          {item.brand && <b>{item.brand}</b>}
          {item.note && <span>{item.note}</span>}
        </span>
      )}
    </button>
  )
}

function SubThumb({ item }: { item: WardrobeItem }) {
  const url = useBlobUrl(item.photo)
  return <span className="sub-thumb">{url && <img src={url} alt="" />}</span>
}

/** 选一件：同一类只留一件（配饰可多选）；连衣裙和上衣/下装互斥 */
function toggle(ids: string[], it: WardrobeItem, items: WardrobeItem[]): string[] {
  if (ids.includes(it.id)) return ids.filter((x) => x !== it.id)
  if (it.category === 'accessory') return [...ids, it.id]
  const clash: Category[] =
    it.category === 'dress' ? ['dress', 'top', 'bottom'] : it.category === 'top' || it.category === 'bottom' ? [it.category, 'dress'] : [it.category]
  return [...ids.filter((x) => !clash.includes(items.find((i) => i.id === x)?.category as Category)), it.id]
}

export default function TodayPick({
  ctx,
  existing,
  onSave,
}: {
  ctx: RecCtx
  existing: OutfitRecord | undefined // 今天已有的记录
  onSave: (ids: string[], photo: Blob | undefined, note: string) => Promise<void>
}) {
  const { items } = useStore()
  const [seed, setSeed] = useState(0)
  const [avoid, setAvoid] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<string[] | null>(null) // null = 跟着推荐/今天的记录
  const [openSub, setOpenSub] = useState<Partial<Record<Category, string>>>({}) // 版本2：点进的子类
  const [note, setNote] = useState(existing?.note ?? '')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoUrl = useBlobUrl(existing?.photo)
  const rk = useMemo(() => rank(items, ctx, seed), [items, ctx, seed])
  const base = useMemo(() => compose(rk, ctx, seed, avoid), [rk, ctx, seed, avoid])
  const worn = existing?.itemIds
  // 推荐（或今天记下的）那几件，排在每行最前面
  const anchor = useMemo(() => (seed === 0 && worn?.length ? worn : base ? recIds(base) : []), [seed, worn, base])
  const ids = (sel ?? anchor).filter((id) => items.some((i) => i.id === id))

  const rows = useMemo(
    () =>
      ROWS.map((cat) => {
        const ranked = (SLOT_ORDER as string[]).includes(cat) ? rk.bySlot[cat as Slot] : []
        const list = [...ranked, ...items.filter((i) => i.category === cat && !ranked.includes(i))]
        return { cat, list: [...list.filter((i) => anchor.includes(i.id)), ...list.filter((i) => !anchor.includes(i.id))] }
      }).filter((r) => r.list.length > 0),
    [items, rk, anchor],
  )

  if (!items.length) return <div className="rec rec-empty">👗 {missingHint(items, ctx)}</div>

  const slots: Rec['slots'] = {}
  for (const id of ids) {
    const it = items.find((i) => i.id === id)
    if (it && (SLOT_ORDER as string[]).includes(it.category)) slots[it.category as Slot] ??= it
  }
  const reasons = ids.length ? reasonsFor(slots, ctx) : []
  const sameIds = !!worn?.length && worn.length === ids.length && ids.every((id) => worn.includes(id))
  const done = sameIds && note.trim() === (existing?.note ?? '')

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const another = () => {
    setAvoid(new Set(ids))
    setSeed(seed + 1)
    setSel(null)
  }
  const wear = () => run(() => onSave(ids, existing?.photo, note.trim()))
  // 照片选好就存进今天这条记录（还没选衣服也先存上）
  const pickPhoto = async (f: File | undefined) => {
    if (!f) return
    try {
      const blob = await normalizePhotoFile(f)
      await run(() => onSave(existing?.itemIds ?? [], blob, existing?.note ?? ''))
    } catch (err) {
      console.error('[照片] 读取失败:', f.name, err)
      alert(`这张照片读不出来（${err instanceof Error ? err.message : String(err)}），请换一张`)
    }
  }
  const delPhoto = () => {
    if (confirm('删掉今天这张照片？')) void run(() => onSave(existing?.itemIds ?? [], undefined, existing?.note ?? ''))
  }

  return (
    <div className="rec">
      <div className="rec-head">
        <b>今天穿这套</b>
        <span className="muted">点同一行的别的衣服就换掉</span>
      </div>
      {!base && <div className="muted">👗 {missingHint(items, ctx)}</div>}
      {rows.map((r) => {
        const subs = SUBTYPES[r.cat]?.map((x) => ({ ...x, list: r.list.filter((i) => i.subtype === x.key) })).filter((x) => x.list.length > 0) ?? []
        const cur = openSub[r.cat]
        const shown = cur ? r.list.filter((i) => i.subtype === cur) : r.list
        return (
          <div className="pick-row" key={r.cat} data-cat={r.cat}>
            <div className="pick-row-head">
              <b>{label(r.cat)}</b>
              <span className="muted">{cur ? `${SUBTYPES[r.cat]?.find((x) => x.key === cur)?.label ?? ''} · ${shown.length} 件` : `${r.list.length} 件`}</span>
            </div>
            {subs.length > 0 && !cur && (
              <div className="sub-grid">
                {subs.map((x) => (
                  <button key={x.key} className="sub-tile" data-sub={x.key} onClick={() => setOpenSub((o) => ({ ...o, [r.cat]: x.key }))}>
                    <span className="sub-stack">
                      {x.list.slice(0, 4).map((it) => <SubThumb key={it.id} item={it} />)}
                    </span>
                    <span className="sub-name">{x.label}</span>
                    <span className="sub-count">{x.list.length} 件</span>
                  </button>
                ))}
              </div>
            )}
            {(shown.length > 0 || subs.length === 0) && (
              <div className="pick-strip">
                {cur && (
                  <button className="sub-back" onClick={() => setOpenSub((o) => ({ ...o, [r.cat]: undefined }))}>‹ {label(r.cat)}</button>
                )}
                {shown.map((it) => (
                  <Tile key={it.id} item={it} on={ids.includes(it.id)} onTap={(x) => setSel(toggle(ids, x, items))} />
                ))}
              </div>
            )}
          </div>
        )
      })}
      {reasons.length > 0 && (
        <div className="chips rec-why">
          {reasons.map((r) => (
            <span key={r} className="badge">{r}</span>
          ))}
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*,.heic,.heif,.livp" hidden onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
      {photoUrl ? (
        <div className="rec-photo">
          <img src={photoUrl} alt="" />
          <div className="rec-btns">
            <button className="photo-btn" disabled={busy} onClick={() => fileRef.current?.click()}>📸 重拍</button>
            <button className="photo-btn" disabled={busy} onClick={delPhoto}>🗑 删除照片</button>
          </div>
        </div>
      ) : (
        <button className="photo-btn rec-add-photo" disabled={busy} onClick={() => fileRef.current?.click()}>
          📸 加一张今天的照片（拍照或相册）
        </button>
      )}
      <input className="rec-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="一句话（可不填）：今天去…" />

      <div className="rec-btns">
        <button className="photo-btn" onClick={another}>🔄 换一套</button>
        <button className="primary" disabled={busy || done || ids.length === 0} onClick={wear}>
          {done ? '✓ 今天已记录' : worn?.length ? '保存修改' : '就穿这套'}
        </button>
      </div>
    </div>
  )
}
