import { useRef, useState } from 'react'
import { identifyClothing, removeBackground } from '../ai'
import { useStore } from '../store'
import { useBlobUrl } from '../useBlobUrl'
import ItemForm from '../components/ItemForm'
import { applyGuess, draftToFields, emptyDraft, type Draft } from '../draft'

type Stage = 'idle' | 'loading' | 'done' | 'failed'

interface Entry {
  key: string
  photo: Blob
  cutout?: Blob
  useCutout: boolean
  bg: Stage
  bgError: string
  ai: Stage
  aiError: string
  draft: Draft
}

function Thumb({ e, on, onClick }: { e: Entry; on: boolean; onClick: () => void }) {
  const url = useBlobUrl(e.useCutout && e.cutout ? e.cutout : e.photo)
  const busy = e.bg === 'loading' || e.ai === 'loading'
  return (
    <button className={`thumb ${on ? 'on' : ''}`} onClick={onClick}>
      {url && <img src={url} alt="" />}
      {busy && <span className="thumb-dot busy" />}
      {!busy && (e.ai === 'failed' || e.bg === 'failed') && <span className="thumb-dot warn" />}
    </button>
  )
}

export default function AddItem({ onDone }: { onDone: () => void }) {
  const { add, settings } = useStore()
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [cur, setCur] = useState(0)
  const [saving, setSaving] = useState(false)
  const entry = entries[Math.min(cur, entries.length - 1)] as Entry | undefined
  const url = useBlobUrl(entry ? (entry.useCutout && entry.cutout ? entry.cutout : entry.photo) : undefined)

  const patch = (key: string, p: Partial<Entry> | ((e: Entry) => Partial<Entry>)) =>
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...(typeof p === 'function' ? p(e) : p) } : e)))

  const process = (e: Entry) => {
    if (!settings.doubaoApiKey) return
    if (settings.removeBg !== false) {
      patch(e.key, { bg: 'loading' })
      removeBackground(e.photo, settings)
        .then((b) => patch(e.key, { cutout: b, bg: 'done' }))
        .catch((err) => patch(e.key, { bg: 'failed', bgError: err instanceof Error ? err.message : String(err) }))
    }
    patch(e.key, { ai: 'loading' })
    identifyClothing(e.photo, settings)
      .then((g) => {
        if (!g) return patch(e.key, { ai: 'failed' })
        patch(e.key, (old) => ({ ai: 'done', draft: applyGuess(old.draft, g) }))
      })
      .catch((err) => patch(e.key, { ai: 'failed', aiError: err instanceof Error ? err.message : String(err) }))
  }

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return
    const added: Entry[] = Array.from(files).map((f) => ({
      key: crypto.randomUUID(),
      photo: f,
      useCutout: true,
      bg: 'idle',
      bgError: '',
      ai: 'idle',
      aiError: '',
      draft: emptyDraft(),
    }))
    setCur(entries.length)
    setEntries((list) => [...list, ...added])
    added.forEach(process)
  }

  const removeCur = () => {
    if (!entry) return
    setEntries((list) => list.filter((e) => e.key !== entry.key))
    setCur((i) => Math.max(0, i - 1))
  }

  const busyCount = entries.filter((e) => e.bg === 'loading' || e.ai === 'loading').length

  const save = async () => {
    if (!entries.length) return
    setSaving(true)
    try {
      for (const e of entries) {
        const final = e.useCutout && e.cutout ? e.cutout : e.photo
        await add({
          photo: final,
          originalPhoto: final !== e.photo ? e.photo : undefined,
          ...draftToFields(e.draft),
        })
      }
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <h1>录入衣服 {entries.length > 1 && <span className="muted">{cur + 1}/{entries.length}</span>}</h1>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
      <input ref={galRef} type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />

      {entries.length > 1 && (
        <div className="thumbs">
          {entries.map((e, i) => (
            <Thumb key={e.key} e={e} on={i === cur} onClick={() => setCur(i)} />
          ))}
        </div>
      )}

      {url && <img className="preview" src={url} alt="" />}
      {entry?.bg === 'loading' && <p className="muted">去背景中（约 1 分钟）…</p>}
      {entry?.bg === 'failed' && <p className="muted">去背景失败，使用原图{entry.bgError ? `（${entry.bgError}）` : ''}</p>}
      {entry?.cutout && (
        <div className="chips">
          <button className={entry.useCutout ? 'on' : ''} onClick={() => patch(entry.key, { useCutout: true })}>白底图</button>
          <button className={!entry.useCutout ? 'on' : ''} onClick={() => patch(entry.key, { useCutout: false })}>原图</button>
        </div>
      )}

      <div className="photo-row">
        <button className="photo-btn" onClick={() => camRef.current?.click()}>📷 拍照</button>
        <button className="photo-btn" onClick={() => galRef.current?.click()}>🖼️ 从相册选（可多选）</button>
      </div>
      {entries.length > 0 && (
        <button className="link danger-link" onClick={removeCur}>移除这张</button>
      )}

      {entry?.ai === 'loading' && <p className="muted">AI 识别中…</p>}
      {entry?.ai === 'done' && <p className="ok">AI 已预填，请确认或修改</p>}
      {entry?.ai === 'failed' && (
        <p className="muted">AI 识别失败，请手动填写{entry.aiError ? `（${entry.aiError}）` : ''}</p>
      )}
      {!settings.doubaoApiKey && entry && (
        <p className="muted">未配置豆包 API Key，请手动填写（可在设置里配置开启 AI 预填）</p>
      )}

      {entry && <ItemForm value={entry.draft} onChange={(d) => patch(entry.key, { draft: d })} />}

      <button className="primary" disabled={!entries.length || saving} onClick={save}>
        {saving ? '保存中…' : entries.length > 1 ? `保存 ${entries.length} 件到衣柜` : '保存到衣柜'}
        {busyCount > 0 && entries.length > 1 ? `（${busyCount} 张还在处理）` : ''}
      </button>
    </div>
  )
}
