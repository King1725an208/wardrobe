import type { Settings, WardrobeItem } from './types'
import { DEFAULT_AI_PROXY } from './ai'
import { itemToJson, jsonToItem } from './backup'

/** 云备份走和 AI 同一个火山函数：把中转地址的 /api/plan/v3 换成 /api/backup */
export function cloudBase(s: Settings): string {
  const base = (s.aiProxyUrl || DEFAULT_AI_PROXY).trim().replace(/\/$/, '')
  if (!base.endsWith('/api/plan/v3')) throw new Error('当前中转地址不支持云备份（需为火山函数网关地址）')
  return base.slice(0, -'/api/plan/v3'.length) + '/api/backup'
}

const CODE_KEY = 'backupCode'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉易混的 I O 0 1

/** 取件码：本机生成一次后固定；换手机时在新机输入旧机的码即可恢复 */
export function getBackupCode(): string {
  let c = localStorage.getItem(CODE_KEY) ?? ''
  if (!/^[A-Za-z0-9]{4,32}$/.test(c)) {
    const buf = new Uint8Array(8)
    crypto.getRandomValues(buf)
    c = Array.from(buf, (b) => ALPHABET[b % ALPHABET.length]).join('')
    localStorage.setItem(CODE_KEY, c)
  }
  return c
}

export function setBackupCode(code: string): string {
  const c = code.trim().toUpperCase()
  if (!/^[A-Za-z0-9]{4,32}$/.test(c)) throw new Error('取件码只能是 4～32 位字母数字')
  localStorage.setItem(CODE_KEY, c)
  return c
}

async function sha16(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function call(s: Settings, url: string, init: RequestInit = {}): Promise<Response> {
  let resp: Response
  try {
    resp = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.doubaoApiKey ?? ''}`, ...(init.headers ?? {}) },
    })
  } catch {
    throw new Error('无法连接中转服务，请检查网络')
  }
  if (!resp.ok) {
    let msg = ''
    try {
      const j = await resp.json()
      msg = j?.error?.message || j?.error || ''
    } catch {
      /* ignore */
    }
    if (resp.status === 401) throw new Error(msg || '口令不对，请检查设置页「口令 / API Key」')
    if (resp.status === 404 && !msg) throw new Error('中转服务还没更新到支持云备份的版本')
    throw new Error(msg || `云端返回 ${resp.status}`)
  }
  return resp
}

export type Progress = (done: number, total: number, label: string) => void

async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) {
      const x = list[i++]
      await fn(x)
    }
  })
  await Promise.all(workers)
}

/** 一键云备份：逐件上传（已存在且未改动的跳过），本地已删的云端也删 */
export async function cloudBackup(
  items: WardrobeItem[],
  s: Settings,
  code: string,
  onProgress: Progress,
): Promise<{ uploaded: number; skipped: number; removed: number }> {
  const base = `${cloudBase(s)}/${code}`
  const remote = (await (await call(s, base)).json()) as { items: { id: string; hash: string }[] }
  const remoteHash = new Map(remote.items.map((r) => [r.id, r.hash]))

  onProgress(0, items.length, '正在整理照片…')
  const payloads: { id: string; hash: string; body: string }[] = []
  for (const it of items) {
    const body = JSON.stringify(await itemToJson(it))
    payloads.push({ id: it.id, hash: await sha16(body), body })
  }
  const todo = payloads.filter((p) => remoteHash.get(p.id) !== p.hash)
  let done = 0
  onProgress(0, todo.length, '正在上传…')
  await pool(todo, 3, async (p) => {
    await call(s, `${base}/items/${p.id}__${p.hash}`, { method: 'PUT', body: p.body })
    done++
    onProgress(done, todo.length, '正在上传…')
  })

  const localIds = new Set(items.map((i) => i.id))
  const stale = remote.items.filter((r) => !localIds.has(r.id))
  await pool(stale, 3, async (r) => {
    await call(s, `${base}/items/${r.id}`, { method: 'DELETE' })
  })
  return { uploaded: todo.length, skipped: payloads.length - todo.length, removed: stale.length }
}

/** 云恢复：按取件码拉回全部衣服（同 id 覆盖本地） */
export async function cloudRestore(s: Settings, code: string, onProgress: Progress): Promise<WardrobeItem[]> {
  const base = `${cloudBase(s)}/${code}`
  const remote = (await (await call(s, base)).json()) as { items: { id: string; hash: string }[] }
  if (!remote.items.length) throw new Error('这个取件码下还没有备份')
  const out: WardrobeItem[] = []
  let done = 0
  onProgress(0, remote.items.length, '正在下载…')
  await pool(remote.items, 3, async (r) => {
    const raw = await (await call(s, `${base}/items/${r.id}__${r.hash}`)).json()
    out.push(await jsonToItem(raw))
    done++
    onProgress(done, remote.items.length, '正在下载…')
  })
  return out
}
