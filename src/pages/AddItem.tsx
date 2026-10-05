import { useRef, useState } from 'react'
import { identifyClothing, removeBackground } from '../ai'
import { useStore } from '../store'
import { CATEGORIES, SEASONS, STYLE_TAGS, type Category, type Season } from '../types'
import { useBlobUrl } from '../useBlobUrl'

export default function AddItem({ onDone }: { onDone: () => void }) {
  const { add, settings } = useStore()
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<Blob>()
  const [cutout, setCutout] = useState<Blob>()
  const [useCutout, setUseCutout] = useState(true)
  const [bgState, setBgState] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle')
  const [bgError, setBgError] = useState('')
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle')
  const [aiError, setAiError] = useState('')
  const [category, setCategory] = useState<Category>('top')
  const [brand, setBrand] = useState('')
  const [purchasedAt, setPurchasedAt] = useState('')
  const [price, setPrice] = useState('')
  const [colors, setColors] = useState('')
  const [styles, setStyles] = useState<string[]>([])
  const [season, setSeason] = useState<Season>('春秋')
  const [material, setMaterial] = useState('')
  const [note, setNote] = useState('')
  const shown = useCutout && cutout ? cutout : photo
  const url = useBlobUrl(shown)

  const onPhoto = async (f: File | undefined) => {
    if (!f) return
    setPhoto(f)
    setCutout(undefined)
    setUseCutout(true)
    setBgState('idle')
    if (!settings.doubaoApiKey) return
    if (settings.removeBg !== false) {
      setBgState('loading')
      setBgError('')
      removeBackground(f, settings)
        .then((b) => {
          setCutout(b)
          setBgState('done')
        })
        .catch((e) => {
          setBgError(e instanceof Error ? e.message : String(e))
          setBgState('failed')
        })
    }
    setAiState('loading')
    setAiError('')
    let g
    try {
      g = await identifyClothing(f, settings)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
      setAiState('failed')
      return
    }
    if (!g) {
      setAiState('failed')
      return
    }
    if (g.category) setCategory(g.category)
    if (g.season) setSeason(g.season)
    if (g.colors?.length) setColors(g.colors.join(' '))
    if (g.styles?.length) setStyles(g.styles)
    if (g.brand) setBrand(g.brand)
    if (g.material) setMaterial(g.material)
    setAiState('done')
  }

  const save = async () => {
    if (!photo) return
    const final = useCutout && cutout ? cutout : photo
    await add({
      photo: final,
      originalPhoto: final !== photo ? photo : undefined,
      category,
      brand: brand || undefined,
      purchasedAt: purchasedAt || undefined,
      price: price ? Number(price) : undefined,
      colors: colors.split(/[\s,，/]+/).filter(Boolean),
      styles,
      season,
      material: material || undefined,
      note: note || undefined,
      wearCount: 0,
    } as never)
    onDone()
  }

  return (
    <div className="page">
      <h1>录入衣服</h1>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
      <input ref={galRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
      {url && <img className="preview" src={url} alt="" />}
      {bgState === 'loading' && <p className="muted">去背景中（约 1 分钟）…</p>}
      {bgState === 'failed' && <p className="muted">去背景失败，使用原图{bgError ? `（${bgError}）` : ''}</p>}
      {cutout && (
        <div className="chips">
          <button className={useCutout ? 'on' : ''} onClick={() => setUseCutout(true)}>白底图</button>
          <button className={!useCutout ? 'on' : ''} onClick={() => setUseCutout(false)}>原图</button>
        </div>
      )}
      <div className="photo-row">
        <button className="photo-btn" onClick={() => camRef.current?.click()}>📷 拍照</button>
        <button className="photo-btn" onClick={() => galRef.current?.click()}>🖼️ 从相册选</button>
      </div>
      {aiState === 'loading' && <p className="muted">AI 识别中…</p>}
      {aiState === 'done' && <p className="ok">AI 已预填，请确认或修改</p>}
      {aiState === 'failed' && (
        <p className="muted">AI 识别失败，请手动填写{aiError ? `（${aiError}）` : ''}</p>
      )}
      {!settings.doubaoApiKey && photo && (
        <p className="muted">未配置豆包 API Key，请手动填写（可在设置里配置开启 AI 预填）</p>
      )}

      <label>分类</label>
      <div className="chips">
        {CATEGORIES.map((c) => (
          <button key={c.key} className={category === c.key ? 'on' : ''} onClick={() => setCategory(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      <label>季节</label>
      <div className="chips">
        {SEASONS.map((s) => (
          <button key={s} className={season === s ? 'on' : ''} onClick={() => setSeason(s)}>
            {s}
          </button>
        ))}
      </div>

      <label>风格（可多选）</label>
      <div className="chips">
        {STYLE_TAGS.map((s) => (
          <button
            key={s}
            className={styles.includes(s) ? 'on' : ''}
            onClick={() => setStyles(styles.includes(s) ? styles.filter((x) => x !== s) : [...styles, s])}
          >
            {s}
          </button>
        ))}
      </div>

      <label>颜色（空格分隔）</label>
      <input value={colors} onChange={(e) => setColors(e.target.value)} placeholder="米白 浅蓝" />
      <label>品牌</label>
      <input value={brand} onChange={(e) => setBrand(e.target.value)} />
      <label>购买时间</label>
      <input type="month" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
      <label>价格（¥）</label>
      <input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      <label>材质</label>
      <input value={material} onChange={(e) => setMaterial(e.target.value)} />
      <label>备注</label>
      <input value={note} onChange={(e) => setNote(e.target.value)} />

      <button className="primary" disabled={!photo} onClick={save}>
        保存到衣柜
      </button>
    </div>
  )
}
