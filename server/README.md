# AI 中转（CORS 代理）

手机浏览器直连火山方舟会被跨域拦截（预检不放行 `Authorization` 头），所以 App 把请求发到这个中转，中转原样转发到
`https://ark.cn-beijing.volces.com/api/plan/v3`。中转不保存任何 Key，Key 由手机端请求头带上。

两种部署方式二选一：

## 方式 A：Cloudflare Workers（免费，推荐）
1. 注册/登录 https://dash.cloudflare.com → 左侧 Workers & Pages → Create → Create Worker → Deploy
2. 点 Edit code，把 `worker.js` 的内容全部粘贴进去替换，Deploy
3. 得到地址形如 `https://xxx.yyy.workers.dev`，填到 App「设置 → AI 中转地址」

## 方式 B：FastAPI（任意能跑 Python 的服务器）
```
pip install fastapi "uvicorn[standard]" httpx
uvicorn app.main:app --host 0.0.0.0 --port 8787
```
