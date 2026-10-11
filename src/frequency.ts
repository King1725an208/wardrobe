import type { Settings, WardrobeItem, WearLevel } from './types'

const DAY = 24 * 3600 * 1000

/** 自动常穿度：近 oftenDays 天穿 >= oftenCount 次 → 经常；>neverDays 天未穿 → 从不；其余 → 不经常。
 *  从未穿过 → undefined（「没定义」：新录入还没积累穿着数据，区别于"放久了从不穿"） */
export function autoWearLevel(item: WardrobeItem, s: Settings, now = Date.now()): WearLevel | undefined {
  const oftenDays = s.oftenDays ?? 90
  const oftenCount = s.oftenCount ?? 3
  const neverDays = s.neverDays ?? 365
  const last = item.lastWornAt
  if (!last) return undefined
  const daysSince = (now - last) / DAY
  if (daysSince > neverDays) return 'never'
  if (daysSince <= oftenDays && item.wearCount >= oftenCount) return 'often'
  return 'rarely'
}

/** 实际生效档位：手动覆盖优先；undefined = 没定义 */
export function wearLevel(item: WardrobeItem, s: Settings, now = Date.now()): WearLevel | undefined {
  return item.manualWearLevel ?? autoWearLevel(item, s, now)
}
