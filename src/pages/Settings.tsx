import { useRef, useState, type ChangeEvent } from 'react'
import { useStore } from '../store'
import { importDemoData } from '../demo'
import { THEMES } from '../types'
import { DEFAULT_AI_PROXY } from '../ai'
import { exportItemsJson, parseItemsJson } from '../backup'
import { bulkPutItems } from '../db'
import { cloudBackup, cloudRestore, getBackupCode, setBackupCode } from '../cloud'

// File System Access API（Chromium 桌面/新版 Edge 支持）：系统「另存为」对话框，可自选保存位置
interface SaveFileHandle {
  createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }>
}
type SaveFilePicker = (opts: {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<SaveFileHandle>

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
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState(getBackupCode)
  const [cloudMsg, setCloudMsg] = useState('')
  const [cloudBusy, setCloudBusy] = useState(false)

  const doCloudBackup = async () => {
    if (!items.length && !window.confirm('本机衣柜是空的，云备份会把云端这个取件码下的衣服全部清空，确定继续？')) return
    setCloudBusy(true)
    try {
      const c = setBackupCode(code)
      setCode(c)
      const r = await cloudBackup(items, settings, c, (d, t, label) => setCloudMsg(`${label} ${d}/${t}`))
      setCloudMsg(`✅ 云备份完成：上传 ${r.uploaded} 件，未改动跳过 ${r.skipped} 件${r.removed ? `，云端删除 ${r.removed} 件` : ''}。取件码：${c}`)
    } catch (err) {
      setCloudMsg(`⚠️ ${err instanceof Error ? err.message : '云备份失败'}`)
    } finally {
      setCloudBusy(false)
    }
  }

  const doCloudRestore = async () => {
    if (!window.confirm(`用取件码「${code.trim().toUpperCase()}」从云端恢复？同 id 的衣服会被云端版本覆盖。`)) return
    setCloudBusy(true)
    try {
      const c = setBackupCode(code)
      setCode(c)
      const list = await cloudRestore(settings, c, (d, t, label) => setCloudMsg(`${label} ${d}/${t}`))
      const existing = new Set(items.map((i) => i.id))
      const added = list.filter((i) => !existing.has(i.id)).length
      await bulkPutItems(list)
      await load()
      setCloudMsg(`✅ 云恢复完成：共 ${list.length} 件（新增 ${added} · 覆盖更新 ${list.length - added}）`)
    } catch (err) {
      setCloudMsg(`⚠️ ${err instanceof Error ? err.message : '云恢复失败'}`)
    } finally {
      setCloudBusy(false)
    }
  }

  const doExport = async () => {
    const name = `电子衣柜备份-${new Date().toISOString().slice(0, 10)}.json`
    // 先弹「另存为」对话框（趁点击手势还有效），选好位置再生成数据；不支持时退回普通下载
    let handle: SaveFileHandle | undefined
    const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
    if (picker) {
      try {
        handle = await picker.call(window, {
          suggestedName: name,
          types: [{ description: 'JSON 备份', accept: { 'application/json': ['.json'] } }],
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return // 用户在对话框里点了取消
        // 其他异常（受限环境等）：退回普通下载
      }
    }
    setBackupBusy(true)
    try {
      const blob = new Blob([await exportItemsJson(items)], { type: 'application/json' })
      if (handle) {
        const w = await handle.createWritable()
        await w.write(blob)
        await w.close()
        setBackupMsg(`✅ 已导出 ${items.length} 件衣服`)
        return
      }
      // ② iOS 微信/手机浏览器：系统分享面板（可选「存储到文件」或发文件传输助手）
      const file = new File([blob], name, { type: 'application/json' })
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: '电子衣柜备份' })
          setBackupMsg(`✅ 已导出 ${items.length} 件衣服（分享菜单里选「存储到文件」即可保存）`)
        } catch (err) {
          if ((err as Error).name === 'AbortError') return // 用户取消了分享
          setBackupMsg('⚠️ 分享失败，请重试')
        }
        return
      }
      // ③ 普通下载（安卓浏览器）
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      setBackupMsg(`✅ 已导出 ${items.length} 件衣服（浏览器不支持选择位置，已存到默认下载目录）`)
    } catch {
      setBackupMsg('⚠️ 导出失败，请重试')
    } finally {
      setBackupBusy(false)
    }
  }

  const doImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // 允许重复选择同一文件
    if (!f) return
    setBackupBusy(true)
    try {
      const list = await parseItemsJson(await f.text())
      const existing = new Set(items.map((i) => i.id))
      const added = list.filter((i) => !existing.has(i.id)).length
      await bulkPutItems(list)
      await load()
      setBackupMsg(`✅ 导入完成：共 ${list.length} 件（新增 ${added} · 覆盖更新 ${list.length - added}）`)
    } catch (err) {
      setBackupMsg(`⚠️ ${err instanceof Error ? err.message : '导入失败'}`)
    } finally {
      setBackupBusy(false)
    }
  }

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
      <label>口令 / API Key</label>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="留空则关闭 AI 预填和云备份"
      />
      {key === KEY_MASK && <p className="muted">已保存（脱敏显示），输入新口令可替换；清空后保存即删除</p>}
      <p className="muted">走内置火山网关时填函数里设的口令（APP_TOKEN），AI 和云备份共用；自建直连中转时填方舟 API Key。</p>
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

      <h2>数据备份</h2>
      <label>取件码（换手机时在新手机输入这个码即可恢复）</label>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="4～32 位字母数字"
        autoCapitalize="characters"
        style={{ letterSpacing: 2, fontWeight: 600 }}
      />
      <div className="row">
        <button className="photo-btn" style={{ aspectRatio: 'auto', padding: 12, flex: 1 }} onClick={doCloudBackup} disabled={cloudBusy}>
          ☁️ 云备份
        </button>
        <button className="photo-btn" style={{ aspectRatio: 'auto', padding: 12, flex: 1 }} onClick={doCloudRestore} disabled={cloudBusy}>
          ☁️ 云恢复
        </button>
      </div>
      {cloudMsg && <p className={cloudMsg.startsWith('⚠️') ? 'muted' : 'ok'}>{cloudMsg}</p>}
      <p className="muted">
        云备份把每件衣服（含照片）存到你自己火山账号的 TOS 里，微信/手机浏览器都能用，不用下载文件；重复备份只传改动过的，本地删掉的云端也会删。恢复时同 id 覆盖、不同 id 新增。需要口令。
      </p>
      <label>本地文件（电脑用）</label>
      <div className="row">
        <button className="photo-btn" style={{ aspectRatio: 'auto', padding: 12, flex: 1 }} onClick={doExport} disabled={backupBusy}>
          导出 JSON
        </button>
        <button className="photo-btn" style={{ aspectRatio: 'auto', padding: 12, flex: 1 }} onClick={() => fileRef.current?.click()} disabled={backupBusy}>
          导入 JSON
        </button>
      </div>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={doImport} />
      <p className="muted">
        JSON 包含每件衣服的全部信息和照片（base64，文件较大），可用于换机迁移；导入时同 id 覆盖、不同 id 新增，不会重复。不含穿搭记录和设置（API Key 不会导出）。
      </p>

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
      {backupMsg && (
        <div className="modal-mask" onClick={() => setBackupMsg('')}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <p className="modal-title">{backupMsg}</p>
            <button className="primary" onClick={() => setBackupMsg('')}>知道了</button>
          </div>
        </div>
      )}
    </div>
  )
}
