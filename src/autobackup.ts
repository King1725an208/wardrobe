import { useSyncExternalStore } from 'react'
import { useStore } from './store'
import { cloudBackup, getBackupCode } from './cloud'

/** 改动后等一会儿再备份，连续录多件只传一次 */
const DELAY_MS = 15_000
const AT_KEY = 'autoBackupAt'
const ERR_KEY = 'autoBackupErr'
const DIRTY_KEY = 'autoBackupDirty' // 有改动还没备份（App 被关掉，下次打开补上）

type Status = { at: number; error: string }
const listeners = new Set<() => void>()
const read = (): Status => ({ at: Number(localStorage.getItem(AT_KEY)) || 0, error: localStorage.getItem(ERR_KEY) ?? '' })
let status = read()

/** 记一次云备份结果（自动/手动都算），error 为空 = 成功 */
export function markBackup(error = ''): void {
  if (error) localStorage.setItem(ERR_KEY, error)
  else {
    localStorage.setItem(AT_KEY, String(Date.now()))
    localStorage.removeItem(ERR_KEY)
    localStorage.removeItem(DIRTY_KEY)
  }
  status = read()
  listeners.forEach((l) => l())
}

export function useBackupStatus(): Status {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => status,
  )
}

let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let again = false

async function run(): Promise<void> {
  timer = undefined
  if (running) {
    again = true
    return
  }
  const { items, outfits, settings } = useStore.getState()
  if (settings.autoBackup === false || !settings.doubaoApiKey) return // 没开或没口令：只在本机，不打扰
  if (!items.length && !outfits.length) return // 本机是空的不自动备份，免得把云端清空
  running = true
  try {
    const r = await cloudBackup(items, outfits, settings, getBackupCode(), () => {}, { safeRemove: true })
    markBackup(r.failed ? `${r.failed} 件没传上去（${r.error}）` : '')
  } catch (e) {
    markBackup(e instanceof Error ? e.message : '自动备份失败')
  } finally {
    running = false
    if (again) {
      again = false
      schedule()
    }
  }
}

function schedule(): void {
  localStorage.setItem(DIRTY_KEY, '1')
  clearTimeout(timer)
  timer = setTimeout(() => void run(), DELAY_MS)
}

/** 启动时调用一次：衣服/穿搭有改动就排一次增量云备份；切到后台时立刻传（手机切走后 App 可能被杀） */
export function startAutoBackup(): void {
  useStore.subscribe((s, prev) => {
    if (!s.loaded) return
    if (!prev.loaded) {
      if (localStorage.getItem(DIRTY_KEY)) schedule()
      return
    }
    if (s.items !== prev.items || s.outfits !== prev.outfits) schedule()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) {
      clearTimeout(timer)
      void run()
    }
  })
}

/** 向浏览器申请「持久存储」：不会因空间紧张/久不打开被自动清理（降低风险，不是绝对保证） */
export async function ensurePersisted(ask = true): Promise<boolean | undefined> {
  const st = navigator.storage
  if (!st?.persisted) return undefined
  try {
    if (await st.persisted()) return true
    return ask && st.persist ? await st.persist() : false
  } catch {
    return undefined
  }
}
