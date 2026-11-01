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

const TIMEOUT_MS = 120_000
const RETRIES = 2

class CloudError extends Error {
  retry: boolean
  constructor(message: string, retry: boolean) {
    super(message)
    this.retry = retry
  }
}

/** 单次请求（含读完响应体）超时即中止，不再无限转圈 */
async function callOnce(s: Settings, url: string, init: RequestInit): Promise<unknown> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    let resp: Response
    try {
      resp = await fetch(url, {
        ...init,
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.doubaoApiKey ?? ''}`, ...(init.headers ?? {}) },
      })
    } catch {
      throw new CloudError(ac.signal.aborted ? '网络太慢，请求超时' : '无法连接中转服务，请检查网络', true)
    }
    let body: unknown = null
    try {
      body = await resp.json()
    } catch {
      if (ac.signal.aborted) throw new CloudError('网络太慢，请求超时', true)
    }
    if (!resp.ok) {
      const e = (body as { error?: { message?: string } | string } | null)?.error
      const msg = (typeof e === 'string' ? e : e?.message) || ''
      if (resp.status === 401) throw new CloudError(msg || '口令不对，请检查设置页「口令 / API Key」', false)
      if (resp.status === 404 && !msg) throw new CloudError('中转服务还没更新到支持云备份的版本', false)
      throw new CloudError(msg || `云端返回 ${resp.status}`, resp.status >= 500)
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

/** 网络错误/超时/5xx 自动重试 2 次 */
async function call(s: Settings, url: string, init: RequestInit = {}): Promise<unknown> {
  for (let i = 0; ; i++) {
    try {
      return await callOnce(s, url, init)
    } catch (e) {
      if (!(e instanceof CloudError && e.retry) || i >= RETRIES) throw e
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
    }
  }
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

/** 一键云备份：逐件「转文本 → 算 hash → 上传 → 释放」，内存只占一件衣服（iPhone Safari 内存很紧，不能先把全部照片转好再传） */
export async function cloudBackup(
  items: WardrobeItem[],
  s: Settings,
  code: string,
  onProgress: Progress,
): Promise<{ uploaded: number; skipped: number; removed: number; failed: number; error: string }> {
  const base = `${cloudBase(s)}/${code}`
  const remote = (await call(s, base)) as { items: { id: string; hash: string }[] }
  const remoteHash = new Map(remote.items.map((r) => [r.id, r.hash]))

  let done = 0
  let uploaded = 0
  let failed = 0
  let error = ''
  onProgress(0, items.length, '正在备份…')
  // 单件失败（重试后仍不行）跳过继续传其他件，最后汇报；下次备份会自动补传
  await pool(items, 2, async (it) => {
    try {
      const body = JSON.stringify(await itemToJson(it))
      const hash = await sha16(body)
      if (remoteHash.get(it.id) !== hash) {
        await call(s, `${base}/items/${it.id}__${hash}`, { method: 'PUT', body })
        uploaded++
      }
    } catch (e) {
      failed++
      error = e instanceof Error ? e.message : String(e)
    }
    done++
    onProgress(done, items.length, '正在备份…')
  })

  const localIds = new Set(items.map((i) => i.id))
  const stale = remote.items.filter((r) => !localIds.has(r.id))
  let removed = 0
  await pool(stale, 2, async (r) => {
    try {
      await call(s, `${base}/items/${r.id}`, { method: 'DELETE' })
      removed++
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  })
  return { uploaded, skipped: items.length - uploaded - failed, removed, failed, error }
}

/** 云恢复：按取件码逐件拉回，每件到手立刻交给 onItem 写库（不在内存里攒），返回件数 */
export async function cloudRestore(
  s: Settings,
  code: string,
  onItem: (item: WardrobeItem) => Promise<void>,
  onProgress: Progress,
): Promise<{ total: number; failed: number; error: string }> {
  const base = `${cloudBase(s)}/${code}`
  const remote = (await call(s, base)) as { items: { id: string; hash: string }[] }
  if (!remote.items.length) throw new Error('这个取件码下还没有备份')
  let done = 0
  let failed = 0
  let error = ''
  onProgress(0, remote.items.length, '正在恢复…')
  await pool(remote.items, 2, async (r) => {
    try {
      const raw = await call(s, `${base}/items/${r.id}__${r.hash}`)
      await onItem(await jsonToItem(raw))
    } catch (e) {
      failed++
      error = e instanceof Error ? e.message : String(e)
    }
    done++
    onProgress(done, remote.items.length, '正在恢复…')
  })
  return { total: remote.items.length, failed, error }
}
