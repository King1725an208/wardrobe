import { useRef, useState } from 'react'
import { removeBackground } from '../ai'
import { useStore } from '../store'
import { autoWearLevel, wearLevel } from '../frequency'
import { CATEGORIES, WEAR_LEVELS, type WardrobeItem, type WearLevel } from '../types'
import { useBlobUrl } from '../useBlobUrl'
import ItemForm from '../components/ItemForm'
import { draftFromItem, draftToFields, type Draft } from '../draft'

function EditItem({ item, onDone }: { item: WardrobeItem; onDone: () => void }) {
  const { settings, update } = useStore()
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Draft>(() => draftFromItem(item))
  // 当前主图 / 原图（换照片后两者都会被替换）
  const [photo, setPhoto] = useState<Blob>(item.photo)
  const [original, setOriginal] = useState<Blob | undefined>(item.originalPhoto)
  const [bg, setBg] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [bgError, setBgError] = useState('')
  const [saving, setSaving] = useState(false)
  const url = useBlobUrl(photo)

  const onNewPhoto = (f: File | undefined) => {
    if (!f) return
    setPhoto(f)
    setOriginal(undefined)
    setBg('idle')
    if (settings.removeBg === false) return
    setBg('loading')
    // 只走 Seedream；失败就用原图
    const p = settings.doubaoApiKey && settings.aiProxyUrl
      ? removeBackground(f, settings)
      : Promise.reject(new Error('未配置 API Key 或中转地址'))
    p
      .then((b) => {
        setPhoto(b)
        setOriginal(f)
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
      await update({ ...item, ...draftToFields(draft), photo, originalPhoto: original })
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <button className="back" onClick={onDone}>← 取消</button>
      <h1>编辑衣服</h1>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onNewPhoto(e.target.files?.[0])} />
      <input ref={galRef} type="file" accept="image/*" hidden onChange={(e) => onNewPhoto(e.target.files?.[0])} />
      {url && <img className="preview" src={url} alt="" />}
      {bg === 'loading' && <p className="muted">去背景中…</p>}
      {bg === 'failed' && <p className="muted">去背景失败，使用原图{bgError ? `（${bgError}）` : ''}</p>}
      {original && (
        <button className="link" onClick={swap}>⇄ 切换到另一张（白底图 / 原图）</button>
      )}
      {bg !== 'loading' && settings.doubaoApiKey && settings.aiProxyUrl && (
        <button className="link" onClick={refine}>效果不好？AI 精修（约 1 分钟）</button>
      )}
      <div className="photo-row">
        <button className="photo-btn" onClick={() => camRef.current?.click()}>📷 重拍</button>
        <button className="photo-btn" onClick={() => galRef.current?.click()}>🖼️ 换一张</button>
      </div>
      <ItemForm value={draft} onChange={setDraft} />
      <button className="primary" disabled={saving || bg === 'loading'} onClick={save}>
        {saving ? '保存中…' : '保存修改'}
      </button>
    </div>
  )
}

export default function ItemDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { items, outfits, settings, update, remove } = useStore()
  const item = items.find((i) => i.id === id)
  const [editing, setEditing] = useState(false)
  const url = useBlobUrl(item?.photo)
  if (!item) return null
  if (editing) return <EditItem item={item} onDone={() => setEditing(false)} />

  const auto = autoWearLevel(item, settings)
  const effective = wearLevel(item, settings)
  const history = outfits.filter((o) => o.itemIds.includes(id))

  const setManual = (lv: WearLevel | undefined) => update({ ...item, manualWearLevel: lv })

  return (
    <div className="page">
      <div className="bar">
        <button className="back" onClick={onBack}>← 返回</button>
        <button className="link" onClick={() => setEditing(true)}>✎ 编辑</button>
      </div>
      {url && <img className="preview" src={url} alt="" />}
      <h2>
        {item.brand || CATEGORIES.find((c) => c.key === item.category)?.label}
        {item.price ? <span className="muted"> ¥{item.price}</span> : null}
      </h2>
      <div className="attrs">
        <div>分类：{CATEGORIES.find((c) => c.key === item.category)?.label}</div>
        <div>季节：{item.season}</div>
        {item.colors.length > 0 && <div>颜色：{item.colors.join('、')}</div>}
        {item.styles.length > 0 && <div>风格：{item.styles.join('、')}</div>}
        {item.purchasedAt && <div>购买：{item.purchasedAt}</div>}
        {item.material && <div>材质：{item.material}</div>}
        {item.note && <div>备注：{item.note}</div>}
        <div>
          穿过 {item.wearCount} 次
          {item.lastWornAt ? `，最近 ${new Date(item.lastWornAt).toLocaleDateString('zh-CN')}` : ''}
        </div>
      </div>

      <label>常穿度（当前：{WEAR_LEVELS.find((w) => w.key === effective)?.label}
        {item.manualWearLevel ? ' · 手动' : ' · 自动' }）</label>
      <div className="chips">
        <button className={!item.manualWearLevel ? 'on' : ''} onClick={() => setManual(undefined)}>
          自动（{WEAR_LEVELS.find((w) => w.key === auto)?.label}）
        </button>
        {WEAR_LEVELS.map((w) => (
          <button
            key={w.key}
            className={item.manualWearLevel === w.key ? 'on' : ''}
            onClick={() => setManual(w.key)}
          >
            {w.label}
          </button>
        ))}
      </div>

      <label>穿着记录（{history.length}）</label>
      <div className="history">
        {history.length === 0 && <span className="muted">还没有穿过</span>}
        {history.map((o) => (
          <span key={o.id} className="badge">{o.date}</span>
        ))}
      </div>

      <button
        className="danger"
        onClick={() => {
          if (confirm('确定删除这件衣服吗？')) {
            remove(item.id)
            onBack()
          }
        }}
      >
        删除这件衣服
      </button>
    </div>
  )
}
