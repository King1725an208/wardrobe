# 电子衣柜 · 服务端存储改造 PRD

> **状态：待实施**（方案已定稿，待确认后开工）
> 创建日期：2026-10-11
> 前置文档：[prd.md](./prd.md)（原「纯本地存储」方案，本文档取代其存储章节）

---

## 1. 背景与目标

原方案为纯本地存储（IndexedDB），数据按「设备 + 浏览器 + 网址（origin）」隔离，手机与电脑互不相通。

**新目标**：

- 前端以**静态网站**形式部署（Vite build 产物，无服务端渲染）
- 手机、电脑访问**同一个地址**，共享**同一份数据**
- 衣物属性、照片、穿搭记录、设置全部存到**一台服务器**上

**部署决策（已定）**：腾讯云 / 火山引擎 **大陆轻量应用服务器**（2核2G），接受 ICP 备案流程，追求访问速度。

> 选型时考虑过但未采用：① 腾讯云/阿里云香港轻量（免备案、贵一些、当天可用）② 家里电脑 + Tailscale（零成本，可作备案过渡期方案，以后也可平滑迁移 VPS——代码无需改动，拷 `server/data/` 目录即可）。

---

## 2. 现状盘点（改造的有利条件）

- 前端：React 19 + TS + Vite PWA；数据全在 IndexedDB（`wardrobe` 库，`items` / `outfits` / `settings` 三表），照片以 Blob 直接存库
- **数据访问被 `src/db.ts` 完美封装**：仅 `store.ts` / `demo.ts` / `Today.tsx` 三处引用（11 个导出函数）
- 照片渲染统一走 `useBlobUrl(Blob)`（8 处调用）
- `server/app/main.py`：FastAPI，目前只是火山方舟 AI 的 CORS 中转（不存 key，客户端带 Authorization）
- `types.ts` 数据模型已预留 `userId` / `syncedAt` 字段
- API Key、代理地址等设置目前存在客户端 IndexedDB

---

## 3. 目标架构

```
手机浏览器 ─┐
            ├→ https://你的域名 → VPS（腾讯云/火山 大陆轻量 2核2G）
电脑浏览器 ─┘                        ├─ nginx :443 → 反代 127.0.0.1:8787
                                     └─ uvicorn → FastAPI（一个进程干 4 件事）
                                        ├─ /         静态托管前端 dist/（SPA fallback，同源免 CORS）
                                        ├─ /api/*    REST API → SQLite（server/data/wardrobe.db）
                                        ├─ /photos/* 照片文件（server/data/photos/）
                                        └─ /ark/*    AI 中转，服务端注入 ARK_API_KEY
```

**顺带解决两个老问题**：

1. 手机不再依赖 workers.dev（国内被墙），AI 中转就是数据源服务器本身
2. API Key 只存服务器环境变量，任何设备开箱即用、不用填 key


---

## 4. 服务端改造（`wardrobe/server/`）

### 4.1 存储设计

SQLite（Python 标准库 `sqlite3`，零额外依赖）+ 照片存磁盘文件：

```
server/data/
├── wardrobe.db          # items / outfits / settings 三张表，属性整行存 JSON
└── photos/              # <itemId>.jpg、<itemId>.orig.jpg、outfit_<id>.jpg
```

单用户几百件衣服规模，JSON 列完全够用（筛选本来就在前端做），不为每个属性建字段。
新增依赖仅 `python-multipart`（multipart 文件上传）。`data/` 加入 `.gitignore`。

### 4.2 REST API（对齐前端 `db.ts` 现有 11 个函数）

| 端点 | 对应前端函数 |
|---|---|
| `GET /api/items` | `listItems`（返回 metadata + photoUrl） |
| `POST /api/items`（multipart：字段 JSON + photo + originalPhoto?） | `addItem` |
| `PUT /api/items/{id}`（JSON 改属性；可选 multipart 换照片） | `updateItem` |
| `DELETE /api/items/{id}` | `deleteItem` |
| `GET /api/outfits`、`POST/PUT /api/outfits`（可带穿搭照） | `listOutfits` / `saveOutfit` / `getOutfitByDate` |
| `POST /api/worn {date, itemIds}` | `markWorn`（"同日只计一次"逻辑服务端化） |
| `GET /api/settings`、`PUT /api/settings` | `getSettings` / `saveSettings` |

### 4.3 鉴权

- 环境变量 `WARDROBE_TOKEN`：设置后 `/api`、`/photos` 必须带 `X-Token` 头；**公网部署必开**
- 前端 localStorage 存一次，401 时引导到设置页输入
- 局域网/开发环境可不设（放行）

### 4.4 AI Key 服务端化

- 环境变量 `ARK_API_KEY`，`/ark/*` 自动注入 `Authorization`
- 客户端若自带 Authorization 则透传（向后兼容）
- CORS：仅开发模式开启（环境变量控制）；生产同源不需要

---

## 5. 前端改造（`wardrobe/src/`，小侵入）

1. **`db.ts` 重写为 HTTP 客户端**：11 个函数**签名保持不变** → `store.ts` / `demo.ts` / `Today.tsx` 三处调用方零改动；Blob ↔ photoUrl 转换封装在 db.ts 内部（加载时抓成 Blob，浏览器 HTTP 缓存加持；保存时 multipart 上传）→ UI 层 8 处 `useBlobUrl` 零改动
   - API base = `import.meta.env.VITE_API_BASE ?? ''`（生产同源为空串；开发期指向 `http://localhost:8787`）
2. **`Settings.tsx`**：删掉「API Key」「中转地址」输入框（服务端接管）；新增「访问令牌」输入；新增**「上传本机数据到服务器」迁移按钮**（IndexedDB 全量逐条 POST，本地数据保留当备份）
3. **`types.ts`**：`Settings.doubaoApiKey` / `aiProxyUrl` 标记废弃；`removeBg` / 穿着频率阈值等保留并改为**全端同步**（settings 存服务器）
4. **上传前压缩（顺手优化）**：canvas 缩到最长边 1600px / JPEG 0.85——VPS 带宽 3~5M，手机原图 5MB+ 直传太慢；`originalPhoto` 同样处理

---

## 6. 行为变化（明确的取舍）

- ✅ 手机/电脑看到**同一个衣柜**，任意端录入全端可见（核心目标）
- ✅ AI 识别 / 去背景流程不变，但任何设备免配 key、免配代理
- ⚠️ 写入需要服务器在线；断网只剩静态壳（后续可加 IndexedDB 只读缓存增强，非本期）
- ⚠️ 完全离线能力回退——可接受，使用场景（家里/外出）基本都有网

---

## 7. 实施步骤

| 阶段 | 内容 | 预计改动 |
|---|---|---|
| **P1** | 服务端 API（db.py + main.py 扩展）+ `db.ts` 重写 + 本地双端联调 | 核心，~500 行 |
| **P2** | Settings 瘦身 + 迁移按钮 + 上传压缩 | ~150 行 |
| **P3** | VPS 部署（买机器后按第 8 节操作） | 纯运维 |

### P1/P2 本地联调验证清单

1. `uvicorn` 起 8787 + vite dev 5173（`VITE_API_BASE` 跨源）开发联调
2. `npm run build` → FastAPI 托管 dist → PC `http://localhost:8787` 全流程验证（录入 → AI 识别 → 去背景 → 保存 → 列表 → 今日穿搭）
3. 手机连同一 WiFi `http://<PC-IP>:8787` 验证拍照录入
4. 迁移按钮上传调试期数据，双端核对一致

---

## 8. VPS 部署指引（腾讯云 / 火山引擎 · 大陆轻量）

1. **买机器**：轻量应用服务器，Ubuntu 24.04，2核2G 即可（新人活动约 ¥60~100/年，续费涨价注意）；控制台防火墙放通 22 / 80 / 443
2. **装环境**：Python 3.12 + poetry → 拉代码 → `poetry install`
3. **常驻进程**：systemd 单元跑 `uvicorn app.main:app --host 127.0.0.1 --port 8787`，环境变量设 `ARK_API_KEY` + `WARDROBE_TOKEN`
4. **买域名 + ICP 备案**：在服务器厂商备案系统提交（上海约 1~3 周，需身份证+人脸）
5. **过渡期**：备案期间用「家里电脑 + Tailscale」或局域网继续用，不耽误
6. **上线**：备案通过 → nginx + 免费证书（厂商 SSL 或 acme.sh 自动续期）→ `https://域名`
7. **收尾**：手机/电脑浏览器打开、加到主屏；迁移按钮上传旧数据
8. **备份**：cron 每日 `tar` 打包 `data/` 目录，或用轻量控制台快照功能

---

## 9. 风险与注意事项

| 风险 | 应对 |
|---|---|
| ICP 备案等待 1~3 周 | Tailscale / 局域网过渡，无感 |
| 公网暴露被扫/被刷 | 必开 `WARDROBE_TOKEN`；仅 443 对外；fail2ban 可选 |
| HTTP 过渡期手机体验 | `<input capture>` 拍照不受 HTTPS 限制可用；「加到主屏」PWA 需等 HTTPS |
| 数据只在一台 VPS 上 | cron 备份 `data/` + 快照；目录拷走即可整体迁移 |
| 服务器宕机期间不可用 | 单用户场景可接受；以后可加 IndexedDB 只读缓存 |

---

## 10. 服务器选型记录

**决策：大陆轻量应用服务器（腾讯云 / 火山引擎），接受备案。**

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **大陆轻量（选定）** | 速度最快、首年最便宜（~¥100/年） | 域名需 ICP 备案（1~3 周） | ✅ |
| 香港轻量 | 免备案、当天可用 | 贵 2~4 倍、延迟略高 | 备选 |
| 家里电脑 + Tailscale | 零成本、免备案 | 电脑需常开 | 过渡期采用 |
| Cloudflare Pages+D1+R2 | 免费额度大 | workers.dev 国内被墙/不稳 | 排除 |

> 火山引擎加分项：方舟 AI Key 同账号管理。腾讯云加分项：轻量控制台友好。
> 配置建议：2核2G、带宽 3~5M 足够（单用户 + 几百张照片 + SQLite）。

