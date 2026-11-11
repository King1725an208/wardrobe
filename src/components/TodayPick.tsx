import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useBlobUrl } from '../useBlobUrl'
import { wearLevel } from '../frequency'
import { normalizePhotoFile } from '../photoFile'
import { CATEGORIES, SUBTYPES, subtypeLabel, WEAR_LEVELS } from '../types'
import type { Category, OutfitRecord, WardrobeItem } from '../types'
import { compose, missingHint, rank, reasonsFor, recIds, SLOT_ORDER, type Rec, type RecCtx, type Slot } from '../recommend'

const ROWS: Category[] = ['outerwear', 'top', 'dress', 'bottom', 'shoes', 'bag', 'accessory']
const label = (c: Category) => CATEGORIES.find((x) => x.key === c)?.label ?? c

/** 品牌 + 子类 + 备注 的一行小字，卡片和选项里共用 */
function metaOf(item: WardrobeItem): string {
  const sub = subtypeLabel(item.category, item.subtype)
  const parts = [item.brand, sub].filter(Boolean)
  return parts.join(' · ')
}

/** 收起态的分类卡：当前穿的那一件 */
function PickCard({ cat, item, on, onOpen, count, selIds }: { cat: Category; item?: WardrobeItem; on: boolean; onOpen: () => void; count?: number; selIds: string[] }) {
  const url = useBlobUrl(item?.photo)
  return (
    <button className={`outfit-card ${on ? 'on' : ''}`} data-cat={cat} data-ids={selIds.join(' ')} onClick={onOpen}>
      {item ? (
        <>
          <span className="oc-img">{url && <img src={url} alt="" />}</span>
          <span className="oc-info">
            <span className="oc-title">{label(cat)} · {metaOf(item) || '未命名'}</span>
            {item.note && <span className="oc-note">备注：{item.note}</span>}
            <span className="oc-sub">点我换一件 ›</span>
          </span>
        </>
      ) : (
        <span className="oc-empty">＋ 选{label(cat)}{count ? `（已选 ${count} 件）` : ''}</span>
      )}
    </button>
  )
}

/** 展开态里的一件候选：图 + 品牌子类 + 备注，点了就换 */
function PickOption({ item, on, onTap }: { item: WardrobeItem; on: boolean; onTap: (it: WardrobeItem) => void }) {
  const url = useBlobUrl(item.photo)
  const { settings } = useStore()
  const lv = wearLevel(item, settings)
  return (
    <button className={`pick-option ${on ? 'on' : ''}`} data-id={item.id} onClick={() => onTap(item)}>
      <span className="po-img">
        {url && <img src={url} alt="" />}
        {on && <span className="tick">✓</span>}
        {lv && lv !== 'often' && <span className={`badge lv-${lv}`}>{WEAR_LEVELS.find((w) => w.key === lv)?.label}</span>}
      </span>
      <span className="po-meta">
        <b>{metaOf(item) || '未命名'}</b>
        {item.note && <span className="po-note">{item.note}</span>}
      </span>
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
  const [openCat, setOpenCat] = useState<Category | null>(null) // 方案C：当前展开换衣的分类
  const [openSub, setOpenSub] = useState<string | undefined>(undefined) // 展开态里点进的子类
  const [note, setNote] = useState(existing?.note ?? '')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoUrl = useBlobUrl(existing?.photo)
  const rk = useMemo(() => rank(items, ctx, seed), [items, ctx, seed])
  const base = useMemo(() => compose(rk, ctx, seed, avoid), [rk, ctx, seed, avoid])
  const worn = existing?.itemIds
  // 推荐（或今天记下的）那几件，排在候选最前面
  const anchor = useMemo(() => (seed === 0 && worn?.length ? worn : base ? recIds(base) : []), [seed, worn, base])
  const ids = (sel ?? anchor).filter((id) => items.some((i) => i.id === id))

  // 每个分类：候选列表（推荐的在前）+ 当前选中的
  const rows = useMemo(
    () =>
      ROWS.map((cat) => {
        const ranked = (SLOT_ORDER as string[]).includes(cat) ? rk.bySlot[cat as Slot] : []
        const list = [...ranked, ...items.filter((i) => i.category === cat && !ranked.includes(i))]
        const ordered = [...list.filter((i) => anchor.includes(i.id)), ...list.filter((i) => !anchor.includes(i.id))]
        return { cat, list: ordered, picked: ordered.filter((i) => ids.includes(i.id)) }
      }).filter((r) => r.list.length > 0),
    [items, rk, anchor, ids],
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
    setOpenCat(null)
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

  // 点候选：配饰可多选留在展开态；其余选完收起卡片
  const pick = (it: WardrobeItem) => {
    setSel(toggle(ids, it, items))
    if (it.category !== 'accessory') {
      setOpenCat(null)
      setOpenSub(undefined)
    }
  }

  const open = rows.find((r) => r.cat === openCat)
  const subs = open
    ? SUBTYPES[open.cat]?.map((x) => ({ ...x, list: open.list.filter((i) => i.subtype === x.key) })).filter((x) => x.list.length > 0) ?? []
    : []
  const options = open ? (openSub ? open.list.filter((i) => i.subtype === openSub) : subs.length ? [] : open.list) : []

  return (
    <div className="rec">
      <div className="rec-head">
        <b>今天穿这套</b>
        <span className="muted">点卡片换衣服，品牌备注都写在图下面</span>
      </div>
      {!base && <div className="muted">👗 {missingHint(items, ctx)}</div>}

      {rows.map((r) =>
        openCat === r.cat ? (
          <div className="outfit-card open" key={r.cat} data-cat={r.cat}>
            <div className="oc-bar">
              <b>{label(r.cat)}</b>
              <button className="oc-close" onClick={() => { setOpenCat(null); setOpenSub(undefined) }}>‹ 收起</button>
            </div>
            {subs.length > 0 && !openSub && (
              <div className="sub-grid">
                {subs.map((x) => (
                  <button key={x.key} className="sub-tile" data-sub={x.key} onClick={() => setOpenSub(x.key)}>
                    <span className="sub-stack">{x.list.slice(0, 4).map((it) => <SubThumb key={it.id} item={it} />)}</span>
                    <span className="sub-name">{x.label}</span>
                    <span className="sub-count">{x.list.length} 件</span>
                  </button>
                ))}
              </div>
            )}
            {(options.length > 0 || subs.length === 0) && (
              <div className="pick-options">
                {openSub && <button className="sub-back" onClick={() => setOpenSub(undefined)}>‹ {label(r.cat)}</button>}
                {(openSub ? options : open!.list).map((it) => (
                  <PickOption key={it.id} item={it} on={ids.includes(it.id)} onTap={(x) => pick(x)} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <PickCard
            key={r.cat}
            cat={r.cat}
            item={r.picked[0]}
            on={r.picked.length > 0}
            count={r.picked.length}
            selIds={r.picked.map((i) => i.id)}
            onOpen={() => { setOpenCat(r.cat); setOpenSub(undefined) }}
          />
        ),
      )}

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
