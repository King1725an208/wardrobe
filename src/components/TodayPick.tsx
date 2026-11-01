import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { useBlobUrl } from '../useBlobUrl'
import { wearLevel } from '../frequency'
import { CATEGORIES, WEAR_LEVELS } from '../types'
import type { WardrobeItem } from '../types'
import { compose, missingHint, rank, recIds, recordedRec, swapSlot, SLOT_ORDER, type Rec, type RecCtx, type Slot } from '../recommend'

function Tile({ item, slot, onSwap, canSwap }: { item: WardrobeItem; slot: Slot; onSwap: (s: Slot) => void; canSwap: boolean }) {
  const url = useBlobUrl(item.photo)
  const { settings } = useStore()
  const lv = wearLevel(item, settings)
  return (
    <button className="rec-tile" data-id={item.id} onClick={() => canSwap && onSwap(slot)} aria-label={`换${slot}`}>
      {url && <img src={url} alt="" />}
      <span className="rec-cat">
        {CATEGORIES.find((c) => c.key === item.category)?.label}
        {canSwap ? ' ↻' : ''}
      </span>
      {lv && lv !== 'often' && <span className={`badge lv-${lv}`}>{WEAR_LEVELS.find((w) => w.key === lv)?.label}</span>}
    </button>
  )
}

export default function TodayPick({
  ctx,
  wornIds,
  onWear,
}: {
  ctx: RecCtx
  wornIds: string[] | undefined // 今天已记录的衣服
  onWear: (ids: string[]) => Promise<void>
}) {
  const { items } = useStore()
  const [seed, setSeed] = useState(0)
  const [avoid, setAvoid] = useState<Set<string>>(new Set())
  const [swapped, setSwapped] = useState<{ seed: number; rec: Rec } | null>(null)
  const [busy, setBusy] = useState(false)
  const rk = useMemo(() => rank(items, ctx, seed), [items, ctx, seed])
  const base = useMemo(() => compose(rk, ctx, seed, avoid), [rk, ctx, seed, avoid])
  // 今天已经记过、还没点「换一套」：直接显示记下的那套
  const recorded = useMemo(() => recordedRec(items, wornIds, ctx), [items, wornIds, ctx])
  const rec = swapped?.seed === seed ? swapped.rec : seed === 0 && recorded ? recorded : base

  if (!rec) return <div className="rec rec-empty">👗 {missingHint(items, ctx)}</div>
  const ids = recIds(rec)
  const done = !!wornIds && wornIds.length === ids.length && ids.every((id) => wornIds.includes(id))

  const another = () => {
    setAvoid(new Set(ids))
    setSeed(seed + 1)
  }
  const wear = async () => {
    setBusy(true)
    try {
      await onWear(ids)
    } finally {
      setBusy(false)
    }
  }
  const slots = SLOT_ORDER.filter((k) => rec.slots[k])

  return (
    <div className="rec">
      <div className="rec-head">
        <b>今天穿这套</b>
        <span className="muted">点某一件可以单独换</span>
      </div>
      <div className={`rec-grid n${slots.length}`}>
        {slots.map((k) => (
          <Tile
            key={k}
            item={rec.slots[k]!}
            slot={k}
            canSwap={rk.bySlot[k].length > 1}
            onSwap={(s) => setSwapped({ seed, rec: swapSlot(rec, rk, s, ctx) })}
          />
        ))}
      </div>
      {rec.reasons.length > 0 && (
        <div className="chips rec-why">
          {rec.reasons.map((r) => (
            <span key={r} className="badge">{r}</span>
          ))}
        </div>
      )}
      <div className="rec-btns">
        <button className="photo-btn" onClick={another}>🔄 换一套</button>
        <button className="primary" disabled={busy || done} onClick={wear}>
          {done ? '✓ 今天已记录' : wornIds ? '改成这套' : '就穿这套'}
        </button>
      </div>
    </div>
  )
}
