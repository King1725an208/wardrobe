import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { wearLevel } from '../frequency'
import { removeBackground } from '../ai'
import { findDuplicates } from '../dup'
import { createPool } from '../pool'
import {
  CATEGORIES, MATERIALS, SEASONS, STANDARD_COLORS, STYLE_TAGS, WEAR_LEVELS,
  type Category, type WearLevel,
} from '../types'
import { useBlobUrl } from '../useBlobUrl'
import type { WardrobeItem } from '../types'

type TagKey = 'category' | 'season' | 'color' | 'style' | 'material' | 'wear'

function Card({ item, onOpen }: { item: WardrobeItem; onOpen: (id: string) => void }) {
  const url = useBlobUrl(item.photo)
  const { settings, update } = useStore()
  const bgPending = useStore((s) => s.bgPending.includes(item.id)) // 后台补抠中：显示角标，好了自动换白底图
  const aiPending = useStore((s) => s.aiPending.includes(item.id)) // 后台识图中：显示角标，识别完自动填颜色/风格
  const [open, setOpen] = useState<TagKey | null>(null)
  const lv = wearLevel(item, settings)
  const lvLabel = lv ? WEAR_LEVELS.find((w) => w.key === lv)!.label : '没定义'
  const catLabel = CATEGORIES.find((c) => c.key === item.category)?.label ?? item.category

  const set = (p: Partial<WardrobeItem>) => update({ ...item, ...p })
  const pick = (k: TagKey) => setOpen((o) => (o === k ? null : k))
  const tag = (k: TagKey, label: string, cls = '') => (
    <button key={`${k}:${label}`} className={`tag ${cls} ${open === k ? 'on' : ''}`} onClick={() => pick(k)}>
      {label}
    </button>
  )
  // 颜色/风格可多选：点选项切换，下拉保持展开
  const toggleArr = (key: 'colors' | 'styles', v: string) => {
    const arr = item[key]
    set({ [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] } as Partial<WardrobeItem>)
  }
  // 单选类：选中即更新并收起
  const choose = (p: Partial<WardrobeItem>) => () => { set(p); setOpen(null) }

  return (
    <div className="card">
      <button className="card-img" onClick={() => onOpen(item.id)}>
        {url ? <img src={url} alt="" /> : <div className="ph" />}
        {(bgPending || aiPending) && <span className="bg-pending">{bgPending ? '抠图中…' : '识图中…'}</span>}
      </button>
      <div className="card-info">
        <div className="card-title" onClick={() => onOpen(item.id)}>
          {item.brand || catLabel}
        </div>
        <div className="tags">
          {tag('category', catLabel)}
          {tag('season', item.season)}
          {item.purchasedAt && <span className="tag">{item.purchasedAt.slice(0, 4)}年</span>}
          {item.colors.length ? item.colors.map((c) => tag('color', c)) : tag('color', '＋颜色', 'tag-add')}
          {item.styles.length ? item.styles.map((s) => tag('style', s)) : tag('style', '＋风格', 'tag-add')}
          {item.material ? tag('material', item.material) : tag('material', '＋材质', 'tag-add')}
          {tag('wear', lvLabel, `lv-${lv ?? 'none'}`)}
        </div>

        {open === 'category' && (
          <div className="tag-drop chips">
            {CATEGORIES.map((c) => (
              <button key={c.key} className={item.category === c.key ? 'on' : ''} onClick={choose({ category: c.key })}>
                {c.label}
              </button>
            ))}
          </div>
        )}
        {open === 'season' && (
          <div className="tag-drop chips">
            {SEASONS.map((s) => (
              <button key={s} className={item.season === s ? 'on' : ''} onClick={choose({ season: s })}>
                {s}
              </button>
            ))}
          </div>
        )}
        {open === 'color' && (
          <div className="tag-drop chips">
            {STANDARD_COLORS.map((c) => (
              <button key={c} className={item.colors.includes(c) ? 'on' : ''} onClick={() => toggleArr('colors', c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        {open === 'style' && (
          <div className="tag-drop chips">
            {STYLE_TAGS.map((s) => (
              <button key={s} className={item.styles.includes(s) ? 'on' : ''} onClick={() => toggleArr('styles', s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {open === 'material' && (
          <div className="tag-drop chips">
            {MATERIALS.map((m) => (
              <button key={m} className={item.material === m ? 'on' : ''}
                onClick={choose({ material: item.material === m ? undefined : m })}>
                {m}
              </button>
            ))}
          </div>
        )}
        {open === 'wear' && (
          <div className="tag-drop chips">
            <button className={!item.manualWearLevel ? 'on' : ''} onClick={choose({ manualWearLevel: undefined })}>
              自动
            </button>
            {WEAR_LEVELS.map((w) => (
              <button key={w.key} className={item.manualWearLevel === w.key ? 'on' : ''} onClick={choose({ manualWearLevel: w.key })}>
                {w.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Wardrobe({ onOpen }: { onOpen: (id: string) => void }) {
  const { items, settings, update, aiPending, enqueueAi } = useStore()
  const bgPending = useStore((s) => s.bgPending) // 去背景任务在飞的衣服：识图任务与之互斥，计数里排除
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [season, setSeason] = useState<string>('all')
  const [style, setStyle] = useState<string>('all')
  const [lv, setLv] = useState<WearLevel | 'all' | 'none'>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'new' | 'worn' | 'price'>('new')
  const [rawOnly, setRawOnly] = useState(false) // 只看待去背景的原图
  const [bgProg, setBgProg] = useState<{ done: number; total: number } | null>(null)
  const [bgMsg, setBgMsg] = useState('')
  const [dupIds, setDupIds] = useState<string[] | null>(null) // 查重结果视图：非空则只显示这些件（同组相邻）
  const [dupProg, setDupProg] = useState<{ done: number; total: number } | null>(null)
  const [dupMsg, setDupMsg] = useState('')
  const [aiMsg, setAiMsg] = useState('')

  const filtered = useMemo(() => {
    // 查重结果视图：只按组序显示这些件，忽略其他筛选
    if (dupIds) {
      const byId = new Map(items.map((i) => [i.id, i]))
      return dupIds.map((id) => byId.get(id)).filter((i): i is WardrobeItem => !!i)
    }
    let list = items
    if (cat !== 'all') list = list.filter((i) => i.category === cat)
    if (rawOnly) list = list.filter((i) => !i.originalPhoto) // 没有原图备份 = 没去背景
    if (season !== 'all') list = list.filter((i) => i.season === season)
    if (style !== 'all') list = list.filter((i) => i.styles.includes(style))
    if (lv === 'none') list = list.filter((i) => wearLevel(i, settings) === undefined)
    else if (lv !== 'all') list = list.filter((i) => wearLevel(i, settings) === lv)
    if (q.trim()) {
      const k = q.trim().toLowerCase()
      list = list.filter(
        (i) =>
          i.brand?.toLowerCase().includes(k) ||
          i.note?.toLowerCase().includes(k) ||
          i.colors.some((c) => c.includes(k))
      )
    }
    return [...list].sort((a, b) => {
      if (sort === 'worn') return (b.lastWornAt ?? 0) - (a.lastWornAt ?? 0)
      if (sort === 'price') return (b.price ?? 0) - (a.price ?? 0)
      return b.createdAt - a.createdAt
    })
  }, [items, cat, season, style, lv, q, sort, settings, rawOnly, dupIds])

  // 批量去背景：并发池(2) 调 Seedream（P2-3，比串行快一倍），成功后主图换成白底图、原图存进 originalPhoto
  const batchRemoveBg = async () => {
    if (!settings.doubaoApiKey) {
      alert('请先在「设置」页配置 API Key')
      return
    }
    const targets = filtered.filter((i) => !i.originalPhoto) // 处理中已完成的会离开筛选，先取快照
    if (!targets.length) return
    setBgMsg('')
    setBgProg({ done: 0, total: targets.length })
    const pool = createPool(2)
    let done = 0
    let failed = 0
    let errMsg = ''
    await Promise.all(
      targets.map((it) =>
        pool(async () => {
          try {
            const cutout = await removeBackground(it.photo, settings)
            // 去背景要约 1 分钟：期间识图/编辑可能已更新这件衣服，写回时以最新数据为准，
            // 只替换照片两个字段，避免把刚识别好的分类等字段盖回旧快照
            const latest = useStore.getState().items.find((x) => x.id === it.id) ?? it
            await update({ ...latest, photo: cutout, originalPhoto: it.photo })
          } catch (e) {
            failed++
            if (!errMsg) errMsg = e instanceof Error ? e.message : String(e)
          }
          done++
          setBgProg({ done, total: targets.length })
        }),
      ),
    )
    setBgProg(null)
    setBgMsg(`去背景完成：成功 ${targets.length - failed} 件${failed ? `，失败 ${failed} 件（${errMsg}）` : ''}`)
  }

  // 批量识图：缺颜色或风格的衣服补 AI 识别。任务落 IDB 后台队列，页面跳掉/关 App 都不丢，下次打开续跑
  // 识图与补抠共用 bgTasks（keyPath=itemId），同件只允许一种在飞：计数/目标都排除正在去背景的，避免「说好 N 件实际只跑 M 件」
  const needsAi = (i: WardrobeItem) => i.colors.length === 0 || i.styles.length === 0
  const aiFree = (i: WardrobeItem) => !aiPending.includes(i.id) && !bgPending.includes(i.id)
  const aiTodo = filtered.filter((i) => needsAi(i) && aiFree(i))
  // 重新识图：当前筛选下所有未在识别/去背景的衣服（覆盖模式，修错分的分类等）
  const aiRedo = filtered.filter(aiFree)
  const batchIdentify = async () => {
    if (!settings.doubaoApiKey) {
      alert('请先在「设置」页配置 API Key')
      return
    }
    const targets = filtered.filter((i) => needsAi(i) && aiFree(i))
    if (!targets.length) return
    if (!window.confirm(`将对 ${targets.length} 件衣服调用 AI 识别，补充颜色/风格/材质/品牌（会消耗 token）。只填空字段，不会覆盖已有内容。确定？`)) return
    setAiMsg(`已加入识别队列 ${targets.length} 件，完成后自动填充；可以随时关闭页面，下次打开继续`)
    for (const it of targets) await enqueueAi(it.id)
  }
  const batchReidentify = async () => {
    if (!settings.doubaoApiKey) {
      alert('请先在「设置」页配置 API Key')
      return
    }
    const targets = filtered.filter(aiFree)
    if (!targets.length) return
    if (!window.confirm(`将对 ${targets.length} 件衣服重新识别，覆盖已有的分类/季节/颜色/风格/材质/品牌（价格、备注等手填内容保留；会消耗 token）。适合修正识别错的分类。确定？`)) return
    setAiMsg(`已加入识别队列 ${targets.length} 件（覆盖模式），完成后自动更新；可以随时关闭页面，下次打开继续`)
    for (const it of targets) await enqueueAi(it.id, 'overwrite')
  }

  // 全衣柜查重：本地感知哈希分组，命中组直接显示在下方（同组相邻、每组最早录入的在前）。
  // 不写任何标记；再点一次「查重」退出结果视图。
  const runDedup = async () => {
    if (dupProg) return
    if (dupIds) {
      setDupIds(null)
      setDupMsg('')
      return
    }
    if (!items.length) return
    setDupMsg('')
    setDupProg({ done: 0, total: items.length })
    const groups = await findDuplicates(items, (done, total) => setDupProg({ done, total }))
    setDupProg(null)
    const ordered = groups.flatMap((g) => [g.keep, ...g.dups].map((i) => i.id))
    if (ordered.length) {
      setRawOnly(false) // 与原图筛选互斥，避免结果列表看似为空
      setDupIds(ordered)
      setDupMsg(`发现 ${groups.length} 组重复（共 ${ordered.length} 件），同组相邻、最早录入的在前；点开确认后可删除。再点「查重」返回全部`)
    } else {
      setDupMsg('没有发现重复的衣服')
    }
  }

  return (
    <div className="page">
      <div className="h1-row">
        <h1>我的衣柜 <span className="muted">{filtered.length} 件</span></h1>
        <div className="h1-btns">
          <button
            className={rawOnly ? 'on' : ''}
            onClick={() => { setRawOnly((v) => !v); setBgMsg(''); setDupIds(null); setDupMsg('') }}
          >
            原图
          </button>
          <button className={dupIds ? 'on' : ''} disabled={dupProg !== null} onClick={runDedup}>
            {dupProg ? `查重中 ${dupProg.done}/${dupProg.total}…` : '查重'}
          </button>
        </div>
      </div>
      {(aiTodo.length > 0 || aiPending.length > 0 || (!!settings.doubaoApiKey && filtered.length > 0)) && (
        <div className="bg-banner">
          <div className="ai-btns">
            {aiTodo.length > 0 && (
              <button className="primary" onClick={batchIdentify}>
                ✨ 一键识图（{aiTodo.length} 件）
              </button>
            )}
            {aiRedo.length > 0 && (
              <button onClick={batchReidentify} title="重做 AI 识别，覆盖已有的分类/颜色等字段">
                🔄 重新识图（{aiRedo.length} 件）
              </button>
            )}
          </div>
          {aiPending.length > 0 && <p className="muted">识图中 {aiPending.length} 件…</p>}
          {aiMsg && <p className="muted">{aiMsg}</p>}
        </div>
      )}
      {rawOnly && (
        <div className="bg-banner">
          {filtered.length > 0 ? (
            <button className="primary" disabled={bgProg !== null} onClick={batchRemoveBg}>
              {bgProg ? `✨ 去背景中 ${bgProg.done}/${bgProg.total}…` : `✨ 一键去背景（${filtered.length} 件）`}
            </button>
          ) : (
            <p className="muted">没有待去背景的原图</p>
          )}
          {bgMsg && <p className="muted">{bgMsg}</p>}
        </div>
      )}
      <input className="search" placeholder="搜索品牌/备注/颜色" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="cats">
        <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>全部</button>
        {CATEGORIES.map((c) => (
          <button key={c.key} className={cat === c.key ? 'on' : ''} onClick={() => setCat(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="filters">
        <select value={season} onChange={(e) => setSeason(e.target.value)}>
          <option value="all">季节</option>
          {SEASONS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="all">风格</option>
          {STYLE_TAGS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={lv} onChange={(e) => setLv(e.target.value as WearLevel | 'all' | 'none')}>
          <option value="all">常穿度</option>
          {WEAR_LEVELS.map((w) => (
            <option key={w.key} value={w.key}>{w.label}</option>
          ))}
          <option value="none">没定义</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="new">最近录入</option>
          <option value="worn">最近穿过</option>
          <option value="price">价格</option>
        </select>
      </div>
      {dupMsg && <p className="muted">{dupMsg}</p>}
      {filtered.length === 0 ? (
        <p className="muted center-pad">
          {items.length === 0 ? '还没有衣服，点底部「＋录入」拍一件吧' : '没有符合条件的衣服，换个筛选试试'}
        </p>
      ) : (
        <div className="grid">
          {filtered.map((i) => (
            <Card key={i.id} item={i} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}
