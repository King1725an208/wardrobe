/**
 * 极简并发池：限制同时在飞的任务数（默认 2），多余排队，按入队顺序执行。
 * 用途：录入多图的 识别+去背景、衣柜批量去背景、后台补抠任务——
 * 避免 N 张照片同时打出 2N 个请求把账号限流和手机带宽打爆。
 */
export function createPool(limit = 2) {
  let active = 0
  const waiting: (() => void)[] = []
  const pump = () => {
    while (active < limit && waiting.length) {
      active++
      waiting.shift()!()
    }
  }
  /** fn 入队；返回的 Promise 在 fn 落定后以同样结果落定 */
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            pump()
          })
      })
      pump()
    })
  }
}
