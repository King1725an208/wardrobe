/**
 * 「先存后补」后台抠图任务的 runner（P2-2）。
 *
 * 任务持久化在 IDB bgTasks：保存时白底图没好就先存原图、落一条任务；
 * App 打开期间用并发池(2)尽力跑，成功后 store 把主图换成白底图（原图存 originalPhoto）；
 * 失败重试（20s×次数 退避，最多 3 次），杀掉/刷新后下次打开 resumeBgTasks 续跑。
 *
 * 诚实说明：移动浏览器/PWA 没有真正的后台 JS 执行（iOS 不支持 Background Fetch），
 * 所以「后台化」= 意图持久化 + 前台尽力完成 + 重开续跑，而不是锁屏后还能跑。
 */
import * as db from './db'
import { removeBackground } from './ai'
import { hasPlainBackground } from './image'
import { createPool } from './pool'
import type { BgTask, Settings } from './types'

const MAX_TRIES = 3
const pool = createPool(2)
const scheduled = new Set<string>() // 本次会话内已入池的 itemId（去重）

let settingsRef: Settings = {}
/** 任务落定回调：(itemId, cutout, err, final)；cutout=null 表示原图已是白底/透明或失败，final=false 表示还会重试 */
type Listener = (itemId: string, cutout: Blob | null, err: string, final: boolean) => void
let listener: Listener = () => {}

export function onBgTaskSettled(cb: Listener) {
  listener = cb
}

async function runTask(t: BgTask) {
  try {
    // 原图已是白底/透明底就不浪费一次生成（例如电商图），直接消任务
    const plain = await hasPlainBackground(t.photo)
    const cutout = plain ? null : await removeBackground(t.photo, settingsRef)
    await db.deleteBgTask(t.itemId)
    scheduled.delete(t.itemId)
    listener(t.itemId, cutout, '', true)
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    t.tries += 1
    t.lastError = err
    scheduled.delete(t.itemId)
    if (t.tries >= MAX_TRIES) {
      // 三次都失败：放弃（主图保持原图，详情页仍可手动重抠），任务清掉
      await db.deleteBgTask(t.itemId)
      listener(t.itemId, null, err, true)
    } else {
      await db.putBgTask(t)
      listener(t.itemId, null, err, false)
      // 会话内退避重试；若中途杀进程，重开后 resume 会接着跑（tries 已落盘）
      setTimeout(() => schedule(t), 20_000 * t.tries)
    }
  }
}

function schedule(t: BgTask) {
  if (scheduled.has(t.itemId)) return
  scheduled.add(t.itemId)
  void pool(() => runTask(t))
}

/** 保存时入队一条补抠任务（同件已有任务则覆盖重来） */
export async function enqueueBgTask(itemId: string, photo: Blob, s: Settings): Promise<void> {
  settingsRef = s
  const t: BgTask = { itemId, photo, tries: 0, createdAt: Date.now() }
  await db.putBgTask(t)
  schedule(t)
}

/** App 启动后续跑残留任务 */
export async function resumeBgTasks(s: Settings): Promise<void> {
  settingsRef = s
  for (const t of await db.listBgTasks()) schedule(t)
}
