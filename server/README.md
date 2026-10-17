# AI 中转（CORS 代理）

手机浏览器直连火山方舟会被跨域拦截（预检不放行 `Authorization` 头），所以 App 把请求发到这个中转，中转原样转发到
`https://ark.cn-beijing.volces.com/api/plan/v3`。中转不保存任何 Key，Key 由手机端请求头带上。

三种部署方式选一（App 会自动适配路径，见下）：

## 方式 A：火山引擎函数服务 + API 网关（国内可直连，推荐；唯一支持云备份的方式）
代码：`vefaas-index.js`（Web 应用函数，Native Node.js 20，启动命令 `node index.js`，端口 8000，API 网关触发器）。
环境变量：
- `ARK_API_KEY`：方舟 Key（函数用它调方舟，手机端不需要真 Key）
- `APP_TOKEN`：访问口令；设置后所有接口要带 `Authorization: Bearer <口令>`，App「设置 → 口令 / API Key」填它
- `BACKUP_DIR`（可选）：备份目录，默认 `/mnt/tos/backup`
- `BACKUP_SKIP_MOUNT_CHECK=1`（仅本地调试）：跳过「挂载目录必须是独立设备」的 TOS 挂载检测

备份接口只有在 `APP_TOKEN` 已设置且 TOS 确实挂载时才开放，否则返回 503。同一口令可访问任意取件码，所以口令只给自家人用。

云备份需在函数配置 → 存储 → 开启 TOS 挂载：桶挂到本地目录 `/mnt/tos`，读写权限（需填有 TOS 权限的 AK/SK）。
文件按 `backup/<取件码>/items/<衣服id>__<hash>.json` 存放。接口：
`GET /api/backup/<code>` 列表 · `PUT/GET/DELETE /api/backup/<code>/items/<id>__<hash>`。
得到的网关地址形如 `https://xxx.apigateway-cn-beijing.volceapi.com/api/plan/v3`，
**完整填到** App「设置 → AI 中转地址」（含 `/api/plan/v3`）；App 自动把 `/api/plan/v3` 换成 `/api/backup` 调云备份。

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
