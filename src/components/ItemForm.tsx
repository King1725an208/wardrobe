import { CATEGORIES, SEASONS, STYLE_TAGS } from '../types'
import type { Draft } from '../draft'

export default function ItemForm({ value, onChange }: { value: Draft; onChange: (d: Draft) => void }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...value, [k]: v })
  return (
    <>
      <label>分类</label>
      <div className="chips">
        {CATEGORIES.map((c) => (
          <button key={c.key} className={value.category === c.key ? 'on' : ''} onClick={() => set('category', c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      <label>季节</label>
      <div className="chips">
        {SEASONS.map((s) => (
          <button key={s} className={value.season === s ? 'on' : ''} onClick={() => set('season', s)}>
            {s}
          </button>
        ))}
      </div>

      <label>风格（可多选）</label>
      <div className="chips">
        {STYLE_TAGS.map((s) => (
          <button
            key={s}
            className={value.styles.includes(s) ? 'on' : ''}
            onClick={() =>
              set('styles', value.styles.includes(s) ? value.styles.filter((x) => x !== s) : [...value.styles, s])
            }
          >
            {s}
          </button>
        ))}
      </div>

      <label>颜色（空格分隔）</label>
      <input value={value.colors} onChange={(e) => set('colors', e.target.value)} placeholder="米白 浅蓝" />
      <label>品牌</label>
      <input value={value.brand} onChange={(e) => set('brand', e.target.value)} />
      <label>购买时间</label>
      <input type="month" value={value.purchasedAt} onChange={(e) => set('purchasedAt', e.target.value)} />
      <label>价格（¥）</label>
      <input type="number" inputMode="decimal" value={value.price} onChange={(e) => set('price', e.target.value)} />
      <label>材质</label>
      <input value={value.material} onChange={(e) => set('material', e.target.value)} />
      <label>备注</label>
      <input value={value.note} onChange={(e) => set('note', e.target.value)} />
    </>
  )
}
