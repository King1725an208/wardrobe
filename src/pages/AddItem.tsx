import { useRef, useState } from 'react'
import type { AddEntry } from '../types'
import { identifyClothing, removeBackground } from '../ai'
import { hasPlainBackground } from '../image'
import { DUP_THRESHOLD, hashDistance, itemHashes, minHashDistance, photoHash } from '../dup'
import { useStore } from '../store'
import { useBlobUrl } from '../useBlobUrl'
import ItemForm from '../components/ItemForm'
import { applyGuess, draftToFields, emptyDraft } from '../draft'
import { normalizePhotoFile } from '../photoFile'

function Thumb({ e, on, onClick }: { e: AddEntry; on: boolean; onClick: () => void }) {
  const url = useBlobUrl(e.useCutout && e.cutout ? e.cutout : e.photo)
  const busy = e.bg === 'loading' || e.ai === 'loading'
  return (
    <button className={`thumb ${on ? 'on' : ''}`} onClick={onClick}>
      {url && <img src={url} alt="" />}
      {busy && <span className="thumb-dot busy" />}
      {!busy && (e.ai === 'failed' || e.bg === 'failed') && <span className="thumb-dot warn" />}
      {!busy && e.dupOf && <span className="thumb-dot dup" />}
    </button>
  )
}

/** 录入查重警示：撞图时暂停 AI，确认「不是重复」才继续识别，也可直接移除这张 */
function DupHint({ e, onContinue, onRemove }: { e: AddEntry; onContinue: () => void; onRemove: () => void }) {
  const item = useStore((s) => s.items.find((i) => i.id === e.dupOf))
  const url = useBlobUrl(item?.photo)
  return (
    <div className="dup-hint">
      {url && <img src={url} alt="" />}
      <span>
        {item
          ? `⚠️ 与衣柜里已有的「${item.brand || '一件衣服'}」照片高度相似，疑似重复，已暂停 AI 识别`
          : '⚠️ 与本批中另一张照片高度相似，疑似重复，已暂停 AI 识别'}
      </span>
      <div className="dup-hint-btns">
        <button onClick={onContinue}>不是重复，继续识别</button>
        <button className="danger" onClick={onRemove}>移除</button>
      </div>
    </div>
  )
}

export default function AddItem({ onDone }: { onDone: () => void }) {
  const { add, settings, addEntries: entries, addCur: cur, setAddCur: setCur, setAddEntries: setEntries } = useStore()
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const entry = entries[Math.min(cur, entries.length - 1)] as AddEntry | undefined
  const url = useBlobUrl(entry ? (entry.useCutout && entry.cutout ? entry.cutout : entry.photo) : undefined)

  const patch = (key: string, p: Partial<AddEntry> | ((e: AddEntry) => Partial<AddEntry>)) =>
    setEntries((list: AddEntry[]) => list.map((e) => (e.key === key ? { ...e, ...(typeof p === 'function' ? p(e) : p) } : e)))

  const process = (e: AddEntry) => {
    if (!settings.doubaoApiKey) return
    if (settings.removeBg !== false) runBg(e)
    patch(e.key, { ai: 'loading' })
    identifyClothing(e.photo, settings)
      .then((g) => {
        if (!g) return patch(e.key, { ai: 'failed' })
        patch(e.key, (old: AddEntry) => ({ ai: 'done', draft: applyGuess(old.draft, g) }))
      })
      .catch((err) => patch(e.key, { ai: 'failed', aiError: err instanceof Error ? err.message : String(err) }))
  }

  // 已是白底/透明底（电商图、已抠图）直接跳过；否则走 Seedream，失败用原图
  const runBg = (e: AddEntry) => {
    if (!settings.doubaoApiKey) return
    patch(e.key, { bg: 'loading', bgError: '' })
    hasPlainBackground(e.photo)
      .then((plain) => {
        // cutout 留空 = 跳过处理，保存时用原图
        if (plain) return patch(e.key, { bg: 'done' })
        return removeBackground(e.photo, settings).then((b) => patch(e.key, { cutout: b, bg: 'done' }))
      })
      .catch((err) => patch(e.key, { bg: 'failed', bgError: err instanceof Error ? err.message : String(err) }))
  }

  // Seedream 精修（约 1 分钟）
  const refine = (e: AddEntry) => {
    if (!settings.doubaoApiKey) return
    patch(e.key, { bg: 'loading', bgError: '' })
    removeBackground(e.photo, settings)
      .then((b) => patch(e.key, { cutout: b, useCutout: true, bg: 'done' }))
      .catch((err) => patch(e.key, { bg: 'failed', bgError: err instanceof Error ? err.message : String(err) }))
  }

  // 录入查重：与衣柜已有衣服 + 本批其他照片比对感知哈希（纯本地计算，无需 API）
  // 返回 true = 疑似重复：调用方应暂停 AI，等人确认
  const checkDup = async (e: AddEntry): Promise<boolean> => {
    try {
      const h = await photoHash(e.key, e.photo)
      for (const it of useStore.getState().items) {
        // 衣柜件比主图+原图全部指纹：它存的可能只是 AI 白底图，单比主图对不上手里的原图
        if (minHashDistance([h], await itemHashes(it)) <= DUP_THRESHOLD) {
          patch(e.key, { dupOf: it.id })
          return true
        }
      }
      for (const o of useStore.getState().addEntries) {
        if (o.key === e.key) continue
        if (hashDistance(h, await photoHash(o.key, o.photo)) <= DUP_THRESHOLD) {
          patch(e.key, { dupOf: 'batch' })
          return true
        }
      }
    } catch {
      /* 哈希失败（如 HEIC 解码失败）不阻塞录入 */
    }
    return false
  }

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    // iPhone 导出的 .livp/.heic 浏览器和 AI 都不认，先归一化成 JPEG；读不出的跳过
    const photos: Blob[] = []
    const bad: string[] = []
    for (const f of Array.from(files)) {
      try {
        photos.push(await normalizePhotoFile(f))
      } catch (err) {
        console.error('[照片] 读取失败:', f.name, err)
        bad.push(`${f.name}（${err instanceof Error ? err.message : String(err)}）`)
      }
    }
    if (bad.length) alert(`有 ${bad.length} 张照片读不出来，已跳过：${bad.join('、')}`)
    if (!photos.length) return
    const added: AddEntry[] = photos.map((p) => ({
      key: crypto.randomUUID(),
      photo: p,
      useCutout: true,
      bg: 'idle',
      bgError: '',
      ai: 'idle',
      aiError: '',
      draft: emptyDraft(),
    }))
    setCur(entries.length)
    setEntries((list) => [...list, ...added])
    added.forEach((e) => {
      // 先查重：疑似重复时暂停 AI（识别+去背景），确认「不是重复」后才补跑，省调用费
      checkDup(e).then((dup) => {
        if (!dup) process(e)
      })
    })
  }

  const removeCur = () => {
    if (!entry) return
    setEntries((list) => list.filter((e) => e.key !== entry.key))
    setCur(Math.max(0, cur - 1))
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
      setEntries([])
      setCur(0)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <h1>录入衣服 {entries.length > 1 && <span className="muted">{cur + 1}/{entries.length}</span>}</h1>
      <input ref={camRef} type="file" accept="image/*,.heic,.heif,.livp" capture="environment" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
      <input ref={galRef} type="file" accept="image/*,.heic,.heif,.livp" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />

      {entries.length > 1 && (
        <div className="thumbs">
          {entries.map((e, i) => (
            <Thumb key={e.key} e={e} on={i === cur} onClick={() => setCur(i)} />
          ))}
        </div>
      )}

      {url && <img className="preview" src={url} alt="" />}
      {entry?.dupOf && (
        <DupHint
          e={entry}
          onContinue={() => {
            patch(entry.key, { dupOf: undefined })
            process(entry) // 确认不是重复：补上被暂停的 AI 识别/去背景
          }}
          onRemove={removeCur}
        />
      )}
      {entry?.bg === 'loading' && <p className="muted">去背景中…</p>}
      {entry?.bg === 'failed' && <p className="muted">去背景失败，使用原图{entry.bgError ? `（${entry.bgError}）` : ''}</p>}
      {entry?.bg === 'done' && !entry.cutout && <p className="muted">检测到已是白底/透明图，已自动跳过去背景</p>}
      {entry?.cutout && (
        <div className="chips">
          <button className={entry.useCutout ? 'on' : ''} onClick={() => patch(entry.key, { useCutout: true })}>白底图</button>
          <button className={!entry.useCutout ? 'on' : ''} onClick={() => patch(entry.key, { useCutout: false })}>原图</button>
        </div>
      )}
      {entry && entry.bg !== 'loading' && settings.doubaoApiKey && (
        <button className="link" onClick={() => refine(entry)}>效果不好？AI 精修（约 1 分钟）</button>
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

      {busyCount > 0 && <p className="muted">可以切去别的页面，回来进度还在</p>}
      <button className="primary" disabled={!entries.length || saving} onClick={save}>
        {saving ? '保存中…' : entries.length > 1 ? `保存 ${entries.length} 件到衣柜` : '保存到衣柜'}
        {busyCount > 0 && entries.length > 1 ? `（${busyCount} 张还在处理）` : ''}
      </button>
    </div>
  )
}
