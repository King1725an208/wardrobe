import { useState } from 'react'
import { useStore } from '../store'
import { importDemoData } from '../demo'

export default function SettingsPage() {
  const { settings, saveSettings, items, load } = useStore()
  const [demoMsg, setDemoMsg] = useState('')
  const [key, setKey] = useState(settings.doubaoApiKey ?? '')
  const [model, setModel] = useState(settings.doubaoModel ?? 'doubao-seed-2.1-turbo')
  const [proxy, setProxy] = useState(settings.aiProxyUrl ?? '')
  const [removeBg, setRemoveBg] = useState(settings.removeBg !== false)
  const [oftenDays, setOftenDays] = useState(settings.oftenDays ?? 90)
  const [oftenCount, setOftenCount] = useState(settings.oftenCount ?? 3)
  const [neverDays, setNeverDays] = useState(settings.neverDays ?? 365)

  const save = () =>
    saveSettings({
      ...settings,
      doubaoApiKey: key || undefined,
      doubaoModel: model || undefined,
      aiProxyUrl: proxy.trim() || undefined,
      removeBg,
      oftenDays,
      oftenCount,
      neverDays,
    })

  const total = items.reduce((s, i) => s + (i.price ?? 0), 0)

  return (
    <div className="page">
      <h1>设置</h1>
      <p className="muted">衣柜共 {items.length} 件{total > 0 ? `，总价值 ¥${total}` : ''}</p>

      <h2>AI 识别（豆包视觉）</h2>
      <label>API Key（火山引擎 Ark）</label>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="留空则关闭 AI 预填"
      />
      <label>模型</label>
      <input value={model} onChange={(e) => setModel(e.target.value)} />
      <label className="row">
        <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} />
        录入时自动去背景（Seedream，每张约 1 分钟、消耗 token）
      </label>
      <label>AI 中转地址（留空用默认；手机无法直连豆包，需经中转）</label>
      <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="默认" />

      <h2>常穿度规则</h2>
      <label>近 N 天穿够次数算「经常」</label>
      <div className="row">
        <input type="number" value={oftenDays} onChange={(e) => setOftenDays(Number(e.target.value))} />
        <span>天内 ≥</span>
        <input type="number" value={oftenCount} onChange={(e) => setOftenCount(Number(e.target.value))} />
        <span>次</span>
      </div>
      <label>超过 N 天没穿算「从不」</label>
      <div className="row">
        <input type="number" value={neverDays} onChange={(e) => setNeverDays(Number(e.target.value))} />
        <span>天</span>
      </div>

      <button className="primary" onClick={save}>保存设置</button>

      <h2>调试</h2>
      <button
        className="photo-btn"
        style={{ aspectRatio: 'auto', padding: 12 }}
        onClick={async () => {
          const n = await importDemoData()
          await load()
          setDemoMsg(n ? `已导入 ${n} 件示例衣服和 3 条穿搭记录` : '示例数据已导入过了')
        }}
      >
        导入示例数据（5 件测试衣服）
      </button>
      {demoMsg && <p className="ok">{demoMsg}</p>}

      <p className="muted">数据只保存在本手机，不会上传。</p>
    </div>
  )
}
