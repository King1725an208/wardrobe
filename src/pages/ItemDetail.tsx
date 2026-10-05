import { useStore } from '../store'
import { autoWearLevel, wearLevel } from '../frequency'
import { CATEGORIES, WEAR_LEVELS, type WearLevel } from '../types'
import { useBlobUrl } from '../useBlobUrl'

export default function ItemDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { items, outfits, settings, update, remove } = useStore()
  const item = items.find((i) => i.id === id)
  const url = useBlobUrl(item?.photo)
  if (!item) return null

  const auto = autoWearLevel(item, settings)
  const effective = wearLevel(item, settings)
  const history = outfits.filter((o) => o.itemIds.includes(id))

  const setManual = (lv: WearLevel | undefined) => update({ ...item, manualWearLevel: lv })

  return (
    <div className="page">
      <button className="back" onClick={onBack}>← 返回</button>
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
