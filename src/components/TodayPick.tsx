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

function OcThumb({ item }: { item: WardrobeItem }) {
  const url = useBlobUrl(item.photo)
  return url ? <img src={url} alt="" /> : null
}

/** 收起态的分类卡：当前穿的那几件（上衣可叠穿多件，带 ＋/－ 控件） */
function PickCard({
  cat,
  items,
  on,
  onOpen,
  count,
  selIds,
  onAdd,
  onRemove,
  canAdd = true,
  canRemove = true,
}: {
  cat: Category
  items: WardrobeItem[]
  on: boolean
  onOpen: () => void
  count?: number
  selIds: string[]
  onAdd?: () => void
  onRemove?: () => void
  canAdd?: boolean
  canRemove?: boolean
}) {
  const first = items[0]
  const url = useBlobUrl(items.length === 1 ? first?.photo : undefined)
  const multi = items.length > 1
  return (
    <div
      className={`outfit-card ${on ? 'on' : ''}`}
      data-cat={cat}
      data-ids={selIds.join(' ')}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {first ? (
        <>
          {multi ? (
            <span className="oc-stack">
              {items.slice(0, 3).map((it) => (
                <OcThumb key={it.id} item={it} />
              ))}
            </span>
          ) : (
            <span className="oc-img">{url && <img src={url} alt="" />}</span>
          )}
          <span className="oc-info">
            <span className="oc-title">{label(cat)} · {multi ? `${items.length} 件叠穿` : metaOf(first) || '未命名'}</span>
            {!multi && first.note && <span className="oc-note">备注：{first.note}</span>}
            <span className="oc-sub">点我换一件 ›</span>
          </span>
          {cat === 'top' && onAdd && onRemove && (
            <span className="oc-ctl">
              <button
                type="button"
                className="oc-step"
                data-act="add"
                disabled={!canAdd}
                title="加一件上衣"
                onClick={(e) => {
                  e.stopPropagation()
                  onAdd()
                }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                ＋
              </button>
              <button
                type="button"
                className="oc-step"
                data-act="remove"
                disabled={!canRemove}
                title="减一件上衣"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove()
                }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                －
              </button>
            </span>
          )}
        </>
      ) : (
        <span className="oc-empty">＋ 选{label(cat)}{count ? `（已选 ${count} 件）` : ''}</span>
      )}
    </div>
  )
}

/** 展开态里的一件候选：图 + 品牌子类 + 备注，点了就换；disabled=已穿不能重复选 */
function PickOption({ item, on, disabled, onTap }: { item: WardrobeItem; on: boolean; disabled?: boolean; onTap: (it: WardrobeItem) => void }) {
  const url = useBlobUrl(item.photo)
  const { settings } = useStore()
  const lv = wearLevel(item, settings)
  return (
    <button className={`pick-option ${on ? 'on' : ''}`} data-id={item.id} disabled={disabled} onClick={() => onTap(item)}>
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

/** 上衣叠穿：一层一张小卡，可单独换/减，末尾一张 ＋ 空卡 */
function TopSlotCard({ item, onOpen, onRemove }: { item: WardrobeItem; onOpen: () => void; onRemove: () => void }) {
  const url = useBlobUrl(item.photo)
  return (
    <div
      className="top-slot"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <span className="ts-img">{url && <img src={url} alt="" />}</span>
      <span className="ts-meta">
        <b>{metaOf(item) || '未命名'}</b>
        {item.note && <span className="ts-note">{item.note}</span>}
      </span>
      <button type="button" className="ts-rm" aria-label="减一件上衣" onClick={(e) => { e.stopPropagation(); onRemove() }} onKeyDown={(e) => e.stopPropagation()}>
        －
      </button>
    </div>
  )
}

function TopSlots({
  tops,
  canAdd,
  onOpenSlot,
  onRemoveSlot,
  onAdd,
}: {
  tops: WardrobeItem[]
  canAdd: boolean
  onOpenSlot: (i: number) => void
  onRemoveSlot: (i: number) => void
  onAdd: () => void
}) {
  return (
    <div className="top-slots" data-cat="top" data-ids={tops.map((t) => t.id).join(' ')}>
      {tops.map((it, i) => (
        <TopSlotCard key={it.id} item={it} onOpen={() => onOpenSlot(i)} onRemove={() => onRemoveSlot(i)} />
      ))}
      <button type="button" className="top-slot add" disabled={!canAdd} onClick={onAdd}>
        <span className="ts-img"><span className="ts-plus">＋</span></span>
        <span className="ts-meta"><span className="ts-empty">选上衣</span></span>
      </button>
    </div>
  )
}

const MAX_TOPS = 4 // 一天最多叠穿 4 件上衣

/** 选一件：上衣/配饰可多选（上衣叠穿），其余同类只留一件；连衣裙和上衣/下装互斥 */
function toggle(ids: string[], it: WardrobeItem, items: WardrobeItem[]): string[] {
  if (ids.includes(it.id)) return ids.filter((x) => x !== it.id)
  if (it.category === 'accessory') return [...ids, it.id]
  if (it.category === 'top') {
    // 上衣可叠穿多件，但连衣裙互斥
    return [...ids.filter((x) => items.find((i) => i.id === x)?.category !== 'dress'), it.id]
  }
  const clash: Category[] =
    it.category === 'dress' ? ['dress', 'top', 'bottom'] : it.category === 'bottom' ? ['bottom', 'dress'] : [it.category]
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
  const [editSlot, setEditSlot] = useState<number | 'add' | null>(null) // 上衣叠穿：正在选哪一层（'add' = 加一层）
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
    setOpenSub(undefined)
    setEditSlot(null)
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

  // 上衣叠穿：当前选中的上衣（按选择顺序）
  const topIds = ids.filter((id) => items.find((i) => i.id === id)?.category === 'top')
  const topItems = topIds.map((id) => items.find((i) => i.id === id)).filter((i): i is WardrobeItem => !!i)
  const hasAddableTop = !!rows.find((r) => r.cat === 'top')?.list.some((i) => !ids.includes(i.id))
  const canAddTop = topIds.length < MAX_TOPS && hasAddableTop
  // －：减一件，去掉最后加的那件（单卡模式）
  const removeTop = () => {
    const last = topIds[topIds.length - 1]
    if (last) setSel(ids.filter((x) => x !== last))
  }
  const closePick = () => {
    setOpenCat(null)
    setOpenSub(undefined)
    setEditSlot(null)
  }
  const openRow = (cat: Category, slot: number | 'add' | null = null) => {
    setEditSlot(cat === 'top' ? slot : null)
    setOpenCat(cat)
    setOpenSub(undefined)
  }
  // 上衣按「层」选：替换第 slot 层，或 add 加一层；选完收起
  const assignTop = (slot: number | 'add', it: WardrobeItem) => {
    if (it.category !== 'top') return
    if (slot === 'add') {
      if (ids.includes(it.id) || topIds.length >= MAX_TOPS) return
      setSel([...ids.filter((x) => items.find((i) => i.id === x)?.category !== 'dress'), it.id])
    } else {
      const oldId = topIds[slot]
      if (!oldId || oldId === it.id) {
        closePick()
        return
      }
      // 已穿在别的层：同一件不能穿两层，直接忽略（避免丢一层）
      if (topIds.some((x, i) => x === it.id && i !== slot)) {
        closePick()
        return
      }
      const next: string[] = []
      for (const x of ids) {
        if (x === oldId) next.push(it.id)
        else if (x !== it.id) next.push(x)
      }
      setSel(next)
    }
    closePick()
  }

  // 点候选：上衣/配饰可多选留在展开态；其余选完收起卡片
  const pick = (it: WardrobeItem) => {
    if (it.category === 'top' && !ids.includes(it.id) && topIds.length >= MAX_TOPS) return
    setSel(toggle(ids, it, items))
    if (it.category !== 'accessory' && it.category !== 'top') {
      setOpenCat(null)
      setOpenSub(undefined)
    }
  }

  const slotOnId = typeof editSlot === 'number' ? (topIds[editSlot] ?? null) : null
  const open = rows.find((r) => r.cat === openCat)
  const subs = open
    ? SUBTYPES[open.cat]?.map((x) => ({ ...x, list: open.list.filter((i) => i.subtype === x.key) })).filter((x) => x.list.length > 0) ?? []
    : []
  const options = open ? (openSub ? open.list.filter((i) => i.subtype === openSub) : subs.length ? [] : open.list) : []
  // 上衣选衣卡里「已穿、不能重复选」的候选：加一层=已穿的都不行；换某层=别的层已穿的不能再选
  const topTaken = (it: WardrobeItem) => {
    if (openCat !== 'top' || editSlot === null) return false
    if (editSlot === 'add') return ids.includes(it.id)
    return topIds.includes(it.id) && it.id !== slotOnId
  }

  return (
    <div className="rec">
      <div className="rec-head">
        <b>今天穿这套</b>
        <span className="muted">点卡片换衣服，品牌备注都写在图下面</span>
      </div>
      {!base && <div className="muted">👗 {missingHint(items, ctx)}</div>}

      {rows.map((r) => {
        if (openCat === r.cat) {
          return (
            <div className="outfit-card open" key={r.cat} data-cat={r.cat}>
              <div className="oc-bar">
                <b>{label(r.cat)}{r.cat === 'top' && r.picked.length > 1 ? ` · 已穿 ${r.picked.length} 件` : ''}</b>
                <button className="oc-close" onClick={() => { setOpenCat(null); setOpenSub(undefined); setEditSlot(null) }}>‹ 收起</button>
              </div>
              {r.cat === 'top' && r.picked.length >= MAX_TOPS && <div className="oc-hint">最多叠穿 {MAX_TOPS} 件，上衣小卡上的 － 可以减一件</div>}
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
                    <PickOption
                      key={it.id}
                      item={it}
                      on={openCat === 'top' && editSlot !== null ? it.id === slotOnId : ids.includes(it.id)}
                      disabled={topTaken(it)}
                      onTap={(x) => (openCat === 'top' && editSlot !== null ? assignTop(editSlot, x) : pick(x))}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        }
        if (r.cat === 'top' && topIds.length >= 2) {
          return (
            <TopSlots
              key="top"
              tops={topItems}
              canAdd={canAddTop}
              onOpenSlot={(i) => openRow('top', i)}
              onRemoveSlot={(i) => setSel(ids.filter((x) => x !== topIds[i]))}
              onAdd={() => openRow('top', 'add')}
            />
          )
        }
        return (
          <PickCard
            key={r.cat}
            cat={r.cat}
            items={r.picked}
            on={r.picked.length > 0}
            count={r.picked.length}
            selIds={r.picked.map((i) => i.id)}
            onOpen={() => openRow(r.cat, r.cat === 'top' ? (r.picked.length ? 0 : 'add') : null)}
            onAdd={r.cat === 'top' ? () => openRow('top', 'add') : undefined}
            onRemove={r.cat === 'top' ? removeTop : undefined}
            canAdd={r.cat === 'top' ? canAddTop : true}
            canRemove={r.cat === 'top' ? topIds.length > 0 : true}
          />
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
      <textarea className="rec-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="感想（可不填）：今天穿着感觉、去了哪、天气如何…" />

      <div className="rec-btns">
        <button className="photo-btn" onClick={another}>🔄 换一套</button>
        <button className="primary" disabled={busy || done || ids.length === 0} onClick={wear}>
          {done ? '✓ 今天已记录' : worn?.length ? '保存修改' : '就穿这套'}
        </button>
      </div>
    </div>
  )
}
