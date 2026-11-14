import { localDate } from './date'

export interface Weather {
  temp: number // 现在温度
  min: number
  max: number
  rainProb: number // 今天最高降水概率 %
  text: string
  rainy: boolean
  wind?: number
  windy?: boolean
}

export interface DayInfo {
  off: boolean // 今天放假（周末/法定节假日，调休上班除外）
  label: string // 工作日 / 周末 / 国庆节 / 调休上班
  week: string // 周日…周六
}

// 上海；Open-Meteo 免费、不用 key、允许跨域
const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=31.23&longitude=121.47' +
  '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
  ',wind_speed_10m_max,wind_gusts_10m_max' +
  '&timezone=Asia%2FShanghai&forecast_days=1'
// 法定节假日 + 调休（NateScarlet/holiday-cn，按国务院通知自动更新）
const holidayUrl = (y: number) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${y}.json`

const WEATHER_KEY = 'weatherCache'
const WEATHER_TTL = 3600_000

/** WMO 天气代码 → 中文 */
function wmoText(c: number): string {
  if (c === 0) return '晴'
  if (c <= 2) return '多云'
  if (c === 3) return '阴'
  if (c === 45 || c === 48) return '雾'
  if (c >= 51 && c <= 57) return '毛毛雨'
  if (c === 61 || c === 80) return '小雨'
  if (c === 63 || c === 81) return '中雨'
  if (c === 65 || c === 82) return '大雨'
  if (c === 66 || c === 67) return '冻雨'
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return '雪'
  if (c >= 95) return '雷阵雨'
  return '多云'
}

async function getJson(url: string): Promise<unknown> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 8000)
  try {
    const r = await fetch(url, { signal: ac.signal })
    if (!r.ok) throw new Error(String(r.status))
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

/** 今天上海天气；1 小时内用缓存，拿不到时退回今天早些时候的缓存，再不行返回 null */
export async function getWeather(): Promise<Weather | null> {
  const today = localDate()
  const cached = JSON.parse(localStorage.getItem(WEATHER_KEY) ?? 'null') as { date: string; at: number; w: Weather } | null
  const sameDay = cached?.date === today ? cached : null
  if (sameDay && Date.now() - sameDay.at < WEATHER_TTL) return sameDay.w
  try {
    const d = (await getJson(WEATHER_URL)) as {
      current: { temperature_2m: number; weather_code: number }
      daily: {
        weather_code: number[]
        temperature_2m_max: number[]
        temperature_2m_min: number[]
        precipitation_probability_max: number[]
        wind_speed_10m_max?: number[]
        wind_gusts_10m_max?: number[]
      }
    }
    const code = d.daily.weather_code[0] ?? d.current.weather_code
    const rainProb = d.daily.precipitation_probability_max[0] ?? 0
    const windMax = d.daily.wind_speed_10m_max?.[0] ?? 0
    const gustMax = d.daily.wind_gusts_10m_max?.[0] ?? 0
    const text = wmoText(code)
    const w: Weather = {
      temp: Math.round(d.current.temperature_2m),
      min: Math.round(d.daily.temperature_2m_min[0] ?? d.current.temperature_2m),
      max: Math.round(d.daily.temperature_2m_max[0] ?? d.current.temperature_2m),
      rainProb,
      text,
      rainy: /雨/.test(text) || rainProb >= 60,
      wind: Math.round(windMax),
      windy: windMax >= 29 || gustMax >= 50, // 5 级持续风或 7 级阵风
    }
    localStorage.setItem(WEATHER_KEY, JSON.stringify({ date: today, at: Date.now(), w }))
    return w
  } catch {
    return sameDay?.w ?? null
  }
}

type HolidayDay = { name: string; date: string; isOffDay: boolean }

async function holidays(year: number): Promise<HolidayDay[] | null> {
  const key = `holidays-${year}`
  const cached = JSON.parse(localStorage.getItem(key) ?? 'null') as { at: number; days: HolidayDay[] } | null
  if (cached && Date.now() - cached.at < 7 * 86400_000) return cached.days
  try {
    const d = (await getJson(holidayUrl(year))) as { days?: HolidayDay[] }
    const days = Array.isArray(d.days) ? d.days : []
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), days }))
    return days
  } catch {
    return cached?.days ?? null
  }
}

/** 今天上班还是放假：先看法定节假日/调休表，拿不到就按周末算 */
export async function getDayInfo(date = localDate()): Promise<DayInfo> {
  const wd = new Date(date + 'T12:00:00').getDay()
  const week = `周${'日一二三四五六'[wd]}`
  const hit = (await holidays(Number(date.slice(0, 4))))?.find((d) => d.date === date)
  if (hit) return hit.isOffDay ? { off: true, label: hit.name, week } : { off: false, label: '调休上班', week }
  return wd === 0 || wd === 6 ? { off: true, label: '周末', week } : { off: false, label: '工作日', week }
}
