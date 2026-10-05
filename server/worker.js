// Cloudflare Worker 版中转（备用方案）：把 /ark/* 原样转发到火山方舟 Agent Plan，并加上 CORS 头。
// 不保存任何 Key，Key 由手机端请求头 Authorization 带上。
const ARK = 'https://ark.cn-beijing.volces.com/api/plan/v3'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
}
export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const url = new URL(req.url)
    if (url.pathname === '/healthz') return Response.json({ ok: true }, { headers: CORS })
    if (!url.pathname.startsWith('/ark/')) return new Response('not found', { status: 404, headers: CORS })
    const auth = req.headers.get('authorization')
    if (!auth) return Response.json({ error: 'missing Authorization' }, { status: 401, headers: CORS })
    const r = await fetch(ARK + url.pathname.slice(4), {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: await req.text(),
    })
    return new Response(r.body, {
      status: r.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  },
}
