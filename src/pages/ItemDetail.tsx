import { useEffect, useRef, useState } from 'react'
import { removeBackground } from '../ai'
import { hasPlainBackground } from '../image'
import { useStore } from '../store'
import { autoWearLevel } from '../frequency'
import { WEAR_LEVELS, type WardrobeItem, type WearLevel } from '../types'
import { useBlobUrl } from '../useBlobUrl'
import ItemForm from '../components/ItemForm'
import { draftFromItem, draftToFields, type Draft } from '../draft'
import { normalizePhotoFile } from '../photoFile'

function EditItem({ item, onDone }: { item: WardrobeItem; onDone: () => void }) {
  const { outfits, settings, update, remove } = useStore()
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Draft>(() => draftFromItem(item))
  // 常穿度手动档位（undefined = 跟随自动），随「保存修改」一起写入
  const [manualLv, setManualLv] = useState<WearLevel | undefined>(item.manualWearLevel)
  // 当前主图 / 原图（换照片后两者都会被替换）
  const [photo, setPhoto] = useState<Blob>(item.photo)
  const [original, setOriginal] = useState<Blob | undefined>(item.originalPhoto)
  const [bg, setBg] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [bgError, setBgError] = useState('')
  const [saving, setSaving] = useState(false)
  const url = useBlobUrl(photo)
  // 「重新识别」：走后台队列（overwrite），落定后把结果同步进表单
  const aiPending = useStore((s) => s.aiPending.includes(item.id))
  const enqueueAi = useStore((s) => s.enqueueAi)
  const [aiNote, setAiNote] = useState('')
  const expectAi = useRef(false)
  const itemAtClick = useRef<WardrobeItem | null>(null)

  const reidentify = () => {
    if (!settings.doubaoApiKey) {
      alert('请先在「设置」页配置 API Key')
      return
    }
    if (!confirm('将重新识别这件衣服并覆盖分类/季节/颜色/风格/材质/品牌（价格、备注等手填内容保留）。确定？')) return
    expectAi.current = true
    itemAtClick.current = item
    setAiNote('')
    void enqueueAi(item.id, 'overwrite')
  }

  // 识别落定（aiPending 由 true 变 false）时 item 已是最新：同步进表单；失败则提示重试
  useEffect(() => {
    if (!expectAi.current || aiPending) return
    expectAi.current = false
    if (itemAtClick.current && item !== itemAtClick.current) {
      setDraft(draftFromItem(item))
      setManualLv(item.manualWearLevel)
      setAiNote('已重新识别，结果已填入表单，请核对后点「保存修改」')
    } else {
      setAiNote('识别没有返回结果（可能失败了），可以再点一次重试')
    }
    itemAtClick.current = null
  }, [aiPending, item])

  const lvLabel = (lv: WearLevel | undefined) => (lv ? WEAR_LEVELS.find((w) => w.key === lv)?.label : '没定义')
  const auto = autoWearLevel(item, settings)
  const effective = manualLv ?? auto
  const history = outfits.filter((o) => o.itemIds.includes(item.id))

  const onNewPhoto = async (f: File | undefined) => {
    if (!f) return
    // iPhone 导出的 .livp/.heic 先归一化成 JPEG，否则预览不了、AI 也会 400
    let blob: Blob
    try {
      blob = await normalizePhotoFile(f)
    } catch (err) {
      console.error('[照片] 读取失败:', f.name, err)
      alert(`这张照片读不出来（${err instanceof Error ? err.message : String(err)}），请换一张`)
      return
    }
    setPhoto(blob)
    setOriginal(undefined)
    setBg('idle')
    setBgError('')
    if (settings.removeBg === false) return
    if (!settings.doubaoApiKey) {
      setBgError('未配置 API Key')
      setBg('failed')
      return
    }
    setBg('loading')
    // 已是白底/透明底就保留原图；否则走 Seedream，失败用原图
    hasPlainBackground(blob)
      .then(async (plain) => {
        if (plain) {
          setBg('idle')
          return
        }
        const b = await removeBackground(blob, settings)
        setPhoto(b)
        setOriginal(blob)
        setBg('idle')
      })
      .catch((e) => {
        setBgError(e instanceof Error ? e.message : String(e))
        setBg('failed')
      })
  }

  // Seedream 精修（约 1 分钟）
  const refine = () => {
    const src = original ?? photo
    if (!src || !settings.doubaoApiKey) return
    setBg('loading')
    removeBackground(src, settings)
      .then((b) => {
        setPhoto(b)
        setOriginal(src)
        setBg('idle')
      })
      .catch((e) => {
        setBgError(e instanceof Error ? e.message : String(e))
        setBg('failed')
      })
  }

  const swap = () => {
    if (!original) return
    setPhoto(original)
    setOriginal(photo)
  }

  const save = async () => {
    setSaving(true)
    try {
      await update({ ...item, ...draftToFields(draft), manualWearLevel: manualLv, photo, originalPhoto: original })
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const del = async () => {
    if (!confirm('确定删除这件衣服吗？')) return
    await remove(item.id)
    onDone()
  }

  return (
    <div className="page">
      <button className="back" onClick={onDone}>← 返回</button>
      <h1>编辑衣服</h1>
      <input ref={camRef} type="file" accept="image/*,.heic,.heif,.livp" capture="environment" hidden onChange={(e) => onNewPhoto(e.target.files?.[0])} />
      <input ref={galRef} type="file" accept="image/*,.heic,.heif,.livp" hidden onChange={(e) => onNewPhoto(e.target.files?.[0])} />
      {url && <img className="preview" src={url} alt="" />}
      {bg === 'loading' && <p className="muted">去背景中…</p>}
      {bg === 'failed' && <p className="muted">去背景失败，使用原图{bgError ? `（${bgError}）` : ''}</p>}
      {original && (
        <button className="link" onClick={swap}>⇄ 切换到另一张（白底图 / 原图）</button>
      )}
      {bg !== 'loading' && settings.doubaoApiKey && (
        <button className="link" onClick={refine}>效果不好？AI 精修（约 1 分钟）</button>
      )}
      {settings.doubaoApiKey && (
        <button className="link" disabled={aiPending} onClick={reidentify}>
          {aiPending ? '✨ AI 识别中…' : '✨ 重新识别（覆盖分类/颜色等字段）'}
        </button>
      )}
      {aiNote && <p className="muted">{aiNote}</p>}
      <div className="photo-row">
        <button className="photo-btn" onClick={() => camRef.current?.click()}>📷 重拍</button>
        <button className="photo-btn" onClick={() => galRef.current?.click()}>🖼️ 换一张</button>
      </div>
      <ItemForm value={draft} onChange={setDraft} />

      <label>常穿度（当前：{lvLabel(effective)}{manualLv ? ' · 手动' : ' · 自动'}）</label>
      <div className="chips">
        <button className={!manualLv ? 'on' : ''} onClick={() => setManualLv(undefined)}>
          自动（{lvLabel(auto)}）
        </button>
        {WEAR_LEVELS.map((w) => (
          <button key={w.key} className={manualLv === w.key ? 'on' : ''} onClick={() => setManualLv(w.key)}>
            {w.label}
          </button>
        ))}
      </div>

      <label>穿着记录（{history.length}）</label>
      <p className="muted">
        穿过 {item.wearCount} 次{item.lastWornAt ? `，最近 ${new Date(item.lastWornAt).toLocaleDateString('zh-CN')}` : ''}
      </p>
      <div className="history">
        {history.length === 0 && <span className="muted">还没有穿过</span>}
        {history.map((o) => (
          <span key={o.id} className="badge">{o.date}</span>
        ))}
      </div>

      <button className="primary" disabled={saving || bg === 'loading' || aiPending} onClick={save}>
        {saving ? '保存中…' : '保存修改'}
      </button>
      <button className="danger" onClick={del}>删除这件衣服</button>
    </div>
  )
}

// 衣柜页点卡片直达编辑页（无中间详情视图）；key 保证换衣服时表单状态重置
export default function ItemDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const item = useStore((s) => s.items.find((i) => i.id === id))
  if (!item) return null
  return <EditItem key={item.id} item={item} onDone={onBack} />
}
