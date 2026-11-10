/**
 * 「先存后补」后台任务的 runner（P2-2 补抠 + 批量识图）。
 *
 * 任务持久化在 IDB bgTasks：
 * - kind='bg'（默认）：保存时白底图没好就先存原图、落一条任务；成功后 store 把主图换成白底图；
 * - kind='ai'：衣柜页「一键识图」批量补 AI 识别属性（只填空字段），任务不存图，运行时读衣物主图。
 *
 * App 打开期间用并发池(2)尽力跑，失败重试（20s×次数 退避，最多 3 次），
 * 杀掉/刷新/网页跳掉后下次打开 resumeBgTasks 续跑——任务意图都在 IDB 里，不会丢。
 *
 * 诚实说明：移动浏览器/PWA 没有真正的后台 JS 执行（iOS 不支持 Background Fetch），
 * 所以「后台化」= 意图持久化 + 前台尽力完成 + 重开续跑，而不是锁屏后还能跑。
 */
import * as db from './db'
import { identifyClothing, removeBackground, type AiGuess } from './ai'
import { hasPlainBackground } from './image'
import { createPool } from './pool'
import type { BgTask, Settings } from './types'

const MAX_TRIES = 3
const pool = createPool(2)
const scheduled = new Set<string>() // 本次会话内已入池的 itemId（去重）

let settingsRef: Settings = {}
/** 补抠落定回调：(itemId, cutout, err, final)；cutout=null 表示原图已是白底/透明或失败，final=false 表示还会重试 */
type Listener = (itemId: string, cutout: Blob | null, err: string, final: boolean) => void
let listener: Listener = () => {}

/** 识图落定回调：(itemId, guess, err, final, mode)；guess=null 表示失败/放弃，final=false 表示还会重试 */
type AiListener = (itemId: string, guess: AiGuess | null, err: string, final: boolean, mode: 'fill' | 'overwrite') => void
let aiListener: AiListener = () => {}

export function onBgTaskSettled(cb: Listener) {
  listener = cb
}

export function onAiTaskSettled(cb: AiListener) {
  aiListener = cb
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 失败退避：tries 落盘，<3 次排队重试，≥3 次放弃并清任务 */
async function failTask(t: BgTask, err: string, settle: (final: boolean) => void) {
  t.tries += 1
  t.lastError = err
  scheduled.delete(t.itemId)
  if (t.tries >= MAX_TRIES) {
    await db.deleteBgTask(t.itemId)
    settle(true)
  } else {
    await db.putBgTask(t)
    settle(false)
    // 会话内退避重试；若中途杀进程，重开后 resume 会接着跑（tries 已落盘）
    setTimeout(() => schedule(t), 20_000 * t.tries)
  }
}

async function runBgTask(t: BgTask) {
  const photo = t.photo
  if (!photo) {
    // 老数据/异常：补抠任务必须带原图，没有就放弃
    await db.deleteBgTask(t.itemId)
    scheduled.delete(t.itemId)
    listener(t.itemId, null, '缺少原图', true)
    return
  }
  try {
    // 原图已是白底/透明底就不浪费一次生成（例如电商图），直接消任务
    const plain = await hasPlainBackground(photo)
    const cutout = plain ? null : await removeBackground(photo, settingsRef)
    await db.deleteBgTask(t.itemId)
    scheduled.delete(t.itemId)
    listener(t.itemId, cutout, '', true)
  } catch (e) {
    await failTask(t, errText(e), (final) => listener(t.itemId, null, t.lastError ?? '', final))
  }
}

async function runAiTask(t: BgTask) {
  try {
    const item = await db.getItem(t.itemId)
    if (!item) {
      // 衣服被删了：任务没意义，直接清掉（不重试）
      await db.deleteBgTask(t.itemId)
      scheduled.delete(t.itemId)
      aiListener(t.itemId, null, '衣服不存在', true, t.mode ?? 'fill')
      return
    }
    const guess = await identifyClothing(item.photo, settingsRef)
    if (!guess) throw new Error('未配置豆包 API Key')
    await db.deleteBgTask(t.itemId)
    scheduled.delete(t.itemId)
    aiListener(t.itemId, guess, '', true, t.mode ?? 'fill')
  } catch (e) {
    await failTask(t, errText(e), (final) => aiListener(t.itemId, null, t.lastError ?? '', final, t.mode ?? 'fill'))
  }
}

async function runTask(t: BgTask) {
  if (t.kind === 'ai') await runAiTask(t)
  else await runBgTask(t)
}

function schedule(t: BgTask) {
  if (scheduled.has(t.itemId)) return
  scheduled.add(t.itemId)
  void pool(() => runTask(t))
}

/** 保存时入队一条补抠任务（同件已有任务则覆盖重来） */
export async function enqueueBgTask(itemId: string, photo: Blob, s: Settings): Promise<void> {
  settingsRef = s
  const t: BgTask = { itemId, photo, kind: 'bg', tries: 0, createdAt: Date.now() }
  await db.putBgTask(t)
  scheduled.delete(itemId) // 可能是在飞交接失败转过来的（holdBgTask 占着位）
  schedule(t)
}

/** 衣柜页识图：给一件衣服补/重做 AI 识别，走同一持久化队列。mode=fill 只填空字段；overwrite 覆盖已有识别字段 */
export async function enqueueAiTask(itemId: string, s: Settings, mode: 'fill' | 'overwrite' = 'fill'): Promise<void> {
  settingsRef = s
  const t: BgTask = { itemId, kind: 'ai', mode, tries: 0, createdAt: Date.now() }
  await db.putBgTask(t)
  schedule(t)
}

/**
 * 保存时抠图还在飞：先把任务落盘占位（防止此时杀掉 App 丢了补图），
 * 但本会话不再重复调用，等在飞结果交接；重开 App 时 resume 会照常续跑它。
 */
export async function holdBgTask(itemId: string, photo: Blob, s: Settings): Promise<void> {
  settingsRef = s
  scheduled.add(itemId)
  await db.putBgTask({ itemId, photo, kind: 'bg', tries: 0, createdAt: Date.now() })
}

/** 在飞结果已交接到衣物上：清掉占位任务 */
export async function releaseBgTask(itemId: string): Promise<void> {
  scheduled.delete(itemId)
  await db.deleteBgTask(itemId)
}

/** App 启动后续跑残留任务（补抠 + 识图） */
export async function resumeBgTasks(s: Settings): Promise<void> {
  settingsRef = s
  for (const t of await db.listBgTasks()) schedule(t)
}
