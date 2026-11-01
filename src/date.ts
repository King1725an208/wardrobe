/** 本机当地日期 YYYY-MM-DD（toISOString 是 UTC，上海早上 8 点前会算成前一天） */
export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
