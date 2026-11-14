import type { DayInfo, Weather } from '../weather'

export default function WeatherCard({ weather, day }: { weather: Weather | null | undefined; day: DayInfo | undefined }) {
  const dayText = day ? `${day.week} · ${day.label}` : '上海'
  if (weather === undefined) return <div className="wx">正在看上海今天的天气…</div>
  if (!weather)
    return (
      <div className="wx">
        <div>
          <b>上海 · 天气没拿到</b>
          <small>{dayText} · 联网后再打开就有了</small>
        </div>
      </div>
    )
  const tip = weather.rainy && weather.windy
    ? ' · 风雨大，记得带伞'
    : weather.rainy
      ? ' · 记得带伞'
      : weather.windy
        ? ' · 风大'
        : weather.max - weather.min >= 8
          ? ' · 早晚温差大'
          : ''
  return (
    <div className="wx">
      <div className="wx-temp">{weather.temp}°</div>
      <div>
        <b>上海 · {weather.text}</b>
        <small>
          {weather.min}~{weather.max}°C · {dayText}
          {weather.rainProb >= 30 ? ` · 降水 ${weather.rainProb}%` : ''}
          {tip}
        </small>
      </div>
    </div>
  )
}
