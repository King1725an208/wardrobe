# AI 中转（CORS 代理）

手机浏览器直连火山方舟会被跨域拦截（预检不放行 `Authorization` 头），所以 App 把请求发到这个中转，中转原样转发到
`https://ark.cn-beijing.volces.com/api/plan/v3`。中转不保存任何 Key，Key 由手机端请求头带上。

三种部署方式选一（App 会自动适配路径，见下）：

## 方式 A：火山引擎 API 网关（国内可直连，推荐）
在火山引擎 API 网关中创建一条到 `https://ark.cn-beijing.volces.com/api/plan/v3/{path}` 的透传路由
（可用函数服务/后端服务实现，需开启 CORS 并允许 `Authorization` 头）。
得到地址形如 `https://xxx.apigateway-cn-beijing.volceapi.com/api/plan/v3`，
**完整填到** App「设置 → AI 中转地址」（含 `/api/plan/v3`）。
优点：国内手机和电脑都能直连，无需任何代理。

## 方式 B：Cloudflare Workers（免费；国内被墙需代理）
1. 注册/登录 https://dash.cloudflare.com → 左侧 Workers & Pages → Create → Create Worker → Deploy
2. 点 Edit code，把 `worker.js` 的内容全部粘贴进去替换，Deploy
3. 得到地址形如 `https://xxx.yyy.workers.dev`（根地址即可），填到 App「设置 → AI 中转地址」

## 方式 C：FastAPI（任意能跑 Python 的服务器）
```
pip install fastapi "uvicorn[standard]" httpx
uvicorn app.main:app --host 0.0.0.0 --port 8787
```
填根地址，如 `http://192.168.1.5:8787`。

---

**路径约定**：App 按中转地址自动拼接口路径——
地址以 `/v3` 结尾（方式 A 的网关）时直接拼 `…/chat/completions`、`…/images/generations`；
否则（方式 B/C，根地址）拼 `/ark/chat/completions`、`/ark/images/generations` 由中转转发。
