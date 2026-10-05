"""豆包(火山方舟 Agent Plan) 的跨域代理。

浏览器直接请求 ark.cn-beijing.volces.com 会被 CORS 拦截（预检不允许 Authorization 头），
所以手机 PWA 把请求发到这里，这里原样转发。API Key 由客户端在 Authorization 头里带上，
服务端不保存任何 key。
"""

import httpx
from fastapi import FastAPI
from fastapi import Request, Response
from fastapi.middleware.cors import CORSMiddleware

ARK_BASE = "https://ark.cn-beijing.volces.com/api/plan/v3"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.post("/ark/{path:path}")
async def ark(path: str, req: Request):
    auth = req.headers.get("authorization")
    if not auth:
        return Response('{"error":"missing Authorization"}', 401, media_type="application/json")
    body = await req.body()
    async with httpx.AsyncClient(timeout=180) as client:
        r = await client.post(
            f"{ARK_BASE}/{path}",
            content=body,
            headers={"Authorization": auth, "Content-Type": "application/json"},
        )
    return Response(r.content, r.status_code, media_type="application/json")
