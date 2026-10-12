import { BRANDS, CATEGORIES, MATERIALS, PRICE_RANGES, SEASONS, STANDARD_COLORS, STYLE_TAGS } from '../types'
import type { Draft } from '../draft'

const SPLIT = /[\s,，/、]+/
const THIS_YEAR = new Date().getFullYear()
// 购买年份 chips：最近 5 年
const YEARS = Array.from({ length: 5 }, (_, i) => String(THIS_YEAR - i))

export default function ItemForm({ value, onChange }: { value: Draft; onChange: (d: Draft) => void }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...value, [k]: v })

  // 颜色草稿是字符串：拆成 token 与 chips 双向同步；标准色之外的自定义色保留为额外 chip
  const colors = value.colors.split(SPLIT).filter(Boolean)
  const toggleColor = (c: string) =>
    set('colors', (colors.includes(c) ? colors.filter((x) => x !== c) : [...colors, c]).join(' '))
  const customColors = colors.filter((c) => !STANDARD_COLORS.includes(c))

  // 价格 chips：当前价格落在区间内则高亮；点选写入区间中间值，再点一下清除
  const priceNum = value.price === '' ? NaN : Number(value.price)
  const inRange = (r: (typeof PRICE_RANGES)[number]) =>
    !Number.isNaN(priceNum) && priceNum >= r.min && priceNum <= r.max

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

      <label>颜色（可多选）</label>
      <div className="chips">
        {STANDARD_COLORS.map((c) => (
          <button key={c} className={colors.includes(c) ? 'on' : ''} onClick={() => toggleColor(c)}>
            {c}
          </button>
        ))}
        {customColors.map((c) => (
          <button key={c} className="on" onClick={() => toggleColor(c)}>
            {c}
          </button>
        ))}
      </div>
      <input value={value.colors} onChange={(e) => set('colors', e.target.value)} placeholder="其他颜色，空格分隔" />

      <label>品牌</label>
      <div className="chips">
        {BRANDS.map((b) => (
          <button key={b} className={value.brand === b ? 'on' : ''} onClick={() => set('brand', value.brand === b ? '' : b)}>
            {b}
          </button>
        ))}
        {value.brand && !BRANDS.includes(value.brand) && (
          <button className="on" onClick={() => set('brand', '')}>
            {value.brand}
          </button>
        )}
      </div>
      <input value={value.brand} onChange={(e) => set('brand', e.target.value)} placeholder="其他品牌，手动输入" />

      <label>购买年份</label>
      <div className="chips">
        {YEARS.map((y) => (
          <button
            key={y}
            className={value.purchasedAt === y ? 'on' : ''}
            onClick={() => set('purchasedAt', value.purchasedAt === y ? '' : y)}
          >
            {y}年
          </button>
        ))}
        {value.purchasedAt && !YEARS.includes(value.purchasedAt) && (
          <button className="on" onClick={() => set('purchasedAt', '')}>
            {value.purchasedAt}年
          </button>
        )}
      </div>

      <label>价格（¥）</label>
      <div className="chips">
        {PRICE_RANGES.map((r) => (
          <button key={r.label} className={inRange(r) ? 'on' : ''} onClick={() => set('price', inRange(r) ? '' : String(r.mid))}>
            {r.label}
          </button>
        ))}
      </div>
      <input
        type="number" inputMode="decimal" value={value.price}
        onChange={(e) => set('price', e.target.value)} placeholder="也可输入精确价格"
      />

      <label>材质</label>
      <div className="chips">
        {MATERIALS.map((m) => (
          <button
            key={m}
            className={value.material === m ? 'on' : ''}
            onClick={() => set('material', value.material === m ? '' : m)}
          >
            {m}
          </button>
        ))}
        {value.material && !MATERIALS.includes(value.material) && (
          <button className="on" onClick={() => set('material', '')}>
            {value.material}
          </button>
        )}
      </div>
      <input value={value.material} onChange={(e) => set('material', e.target.value)} placeholder="其他材质，手动输入" />

      <label>备注</label>
      <input value={value.note} onChange={(e) => set('note', e.target.value)} />
    </>
  )
}
