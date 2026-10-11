import { useState } from 'react'
import { useStore } from '../store'
import { importDemoData } from '../demo'
import { THEMES } from '../types'
import { DEFAULT_AI_PROXY } from '../ai'

/** 已保存的 API Key 在输入框里以此占位显示（脱敏）；保存时若未被改动则保留原值 */
const KEY_MASK = 'XXXXXXXXXXXXX'

const SWATCHES: Record<string, string[]> = {
  forest: ['#f4f6f0', '#7a9a7e', '#dfeadb', '#2f3a30'],
  cream: ['#f7f4ee', '#9db89a', '#fbe9e3', '#4a4238'],
  mint: ['#eef3f1', '#5f8f86', '#d6ebe3', '#2e3d3a'],
}

export default function SettingsPage() {
  const { settings, saveSettings, items, load } = useStore()
  const [demoMsg, setDemoMsg] = useState('')
  const [key, setKey] = useState(settings.doubaoApiKey ? KEY_MASK : '')
  const [model, setModel] = useState(settings.doubaoModel ?? 'doubao-seed-2.1-pro')
  const [proxy, setProxy] = useState(settings.aiProxyUrl ?? DEFAULT_AI_PROXY)
  const [savedOpen, setSavedOpen] = useState(false)
  const [removeBg, setRemoveBg] = useState(settings.removeBg !== false)
  const [oftenDays, setOftenDays] = useState(settings.oftenDays ?? 90)
  const [oftenCount, setOftenCount] = useState(settings.oftenCount ?? 3)
  const [neverDays, setNeverDays] = useState(settings.neverDays ?? 365)

  const save = () => {
    saveSettings({
      doubaoApiKey: key === KEY_MASK ? settings.doubaoApiKey : key || undefined,
      doubaoModel: model || undefined,
      aiProxyUrl: proxy.trim() || undefined,
      removeBg,
      oftenDays,
      oftenCount,
      neverDays,
    })
    setSavedOpen(true)
  }

  const total = items.reduce((s, i) => s + (i.price ?? 0), 0)

  return (
    <div className="page">
      <h1>设置</h1>
      <p className="muted">衣柜共 {items.length} 件{total > 0 ? `，总价值 ¥${total}` : ''}</p>

      <h2>外观风格</h2>
      <div className="theme-row">
        {THEMES.map((t) => (
          <button
            key={t.key}
            className={`theme-opt ${(settings.theme ?? 'forest') === t.key ? 'on' : ''}`}
            onClick={() => saveSettings({ theme: t.key })}
          >
            <span className="sw">
              {SWATCHES[t.key].map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            {t.label}
          </button>
        ))}
      </div>
      <p className="muted">点一下立即生效</p>

      <h2>AI 识别（豆包视觉）</h2>
      <label>API Key（火山引擎 Ark）</label>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="留空则关闭 AI 预填"
      />
      {key === KEY_MASK && <p className="muted">已保存（脱敏显示），输入新 Key 可替换；清空后保存即删除</p>}
      <label>模型</label>
      <input value={model} onChange={(e) => setModel(e.target.value)} />
      <label className="row">
        <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} />
        录入时自动去背景（Seedream，每张约 1 分钟；失败用原图）
      </label>
      <label>AI 中转地址（已内置火山 API 网关，一般无需修改）</label>
      <input
        type="password"
        value={proxy}
        onChange={(e) => setProxy(e.target.value)}
        placeholder="内置默认：火山 API 网关"
      />
      <p className="muted">密码式隐藏显示。默认走内置火山 API 网关（国内手机/电脑直连，无需部署）；清空后保存也会回到内置默认。自建过 FastAPI/Worker 中转可换成 http://电脑IP:8787 等地址。</p>

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
      <p className="muted">版本 {__BUILD_TIME__}</p>

      {savedOpen && (
        <div className="modal-mask" onClick={() => setSavedOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <p className="modal-title">✅ 设置已保存</p>
            <button className="primary" onClick={() => setSavedOpen(false)}>知道了</button>
          </div>
        </div>
      )}
    </div>
  )
}
