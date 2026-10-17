// index.js —— 火山引擎函数服务（Web 应用函数，Native Node.js 20）
// 1) Agent Plan 反向代理：/api/plan/... → 方舟，Key 用环境变量 ARK_API_KEY
// 2) 云备份：/api/backup/... → 写入挂载的 TOS 目录（函数配置 → 存储 → TOS 挂载到 /mnt/tos）
// 3) 口令：环境变量 APP_TOKEN 设置后，所有接口都要带 Authorization: Bearer <口令>（App 设置页「口令 / API Key」）
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env._FAAS_RUNTIME_PORT || 8000);
const ARK_BASE_URL = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com';
const ARK_API_KEY = process.env.ARK_API_KEY || '';
const APP_TOKEN = (process.env.APP_TOKEN || '').trim();
const BACKUP_DIR = process.env.BACKUP_DIR || '/mnt/tos/backup';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const CODE_RE = /^[A-Za-z0-9]{4,32}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HASH_RE = /^[a-f0-9]{8,64}$/;

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// TOS 挂载检测：挂载目录和根目录不在同一设备上才算真的挂上了，
// 防止挂载失败时把备份写进函数实例的本地磁盘（实例重建即丢失）。
// 本地调试可设 BACKUP_SKIP_MOUNT_CHECK=1 跳过。
function backupMounted() {
  try {
    const mountDir = path.dirname(BACKUP_DIR);
    if (!fs.existsSync(mountDir)) return false;
    if (process.env.BACKUP_SKIP_MOUNT_CHECK === '1') return true;
    return fs.statSync(mountDir).dev !== fs.statSync('/').dev;
  } catch {
    return false;
  }
}

// 文件名约定：<衣服id>__<内容hash>.json，列目录即可知道哪些需要重传
async function handleBackup(req, res, parts) {
  if (!backupMounted()) {
    return json(res, 503, { error: { message: '云端存储未挂载：请在函数配置 → 存储 里挂载 TOS 到 /mnt/tos' } });
  }
  const [code, sub, id] = parts; // /api/backup/<code>[/items/<id>[__hash]]
  if (!CODE_RE.test(code || '')) return json(res, 400, { error: { message: '取件码格式不对' } });
  const dir = path.join(BACKUP_DIR, code, 'items');

  // GET /api/backup/<code> → 列表
  if (!sub && req.method === 'GET') {
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      /* 还没备份过 */
    }
    const items = [];
    for (const f of files) {
      const m = /^([A-Za-z0-9_-]+)__([a-f0-9]+)\.json$/.exec(f);
      if (m) items.push({ id: m[1], hash: m[2] });
    }
    return json(res, 200, { ok: true, code, items });
  }

  if (sub !== 'items' || !id) return json(res, 404, { error: { message: 'not found' } });
  const [itemId, hash] = id.replace(/\.json$/, '').split('__');
  if (!ID_RE.test(itemId)) return json(res, 400, { error: { message: '衣服 id 格式不对' } });

  // PUT /api/backup/<code>/items/<id>__<hash> → 写入（先写临时文件再改名，避免半截文件）
  if (req.method === 'PUT') {
    if (!HASH_RE.test(hash || '')) return json(res, 400, { error: { message: '缺少内容 hash' } });
    const body = await readBody(req);
    if (!body.length) return json(res, 400, { error: { message: '空内容' } });
    try {
      JSON.parse(body.toString('utf8'));
    } catch {
      return json(res, 400, { error: { message: '不是合法 JSON' } });
    }
    fs.mkdirSync(dir, { recursive: true });
    const finalName = `${itemId}__${hash}.json`;
    const tmp = path.join(dir, `.${finalName}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, path.join(dir, finalName));
    // 删掉同一件衣服的旧版本
    for (const f of fs.readdirSync(dir)) {
      if (f !== finalName && f.startsWith(`${itemId}__`)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }
    return json(res, 200, { ok: true, id: itemId, hash });
  }

  // GET /api/backup/<code>/items/<id> → 读取（不带 hash 时取当前版本）
  if (req.method === 'GET') {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { /* ignore */ }
    const f = hash ? `${itemId}__${hash}.json` : files.find((x) => x.startsWith(`${itemId}__`) && x.endsWith('.json'));
    if (!f || !files.includes(f)) return json(res, 404, { error: { message: '云端没有这件衣服' } });
    const data = fs.readFileSync(path.join(dir, f));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(data);
  }

  // DELETE /api/backup/<code>/items/<id> → 删除该衣服所有版本
  if (req.method === 'DELETE') {
    let n = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(`${itemId}__`)) { fs.unlinkSync(path.join(dir, f)); n++; }
      }
    } catch { /* ignore */ }
    return json(res, 200, { ok: true, removed: n });
  }

  return json(res, 405, { error: { message: 'method not allowed' } });
}

function proxyArk(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const targetUrl = new URL(req.url, ARK_BASE_URL);
    const upstreamHeaders = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      Authorization: `Bearer ${ARK_API_KEY}`,
      Accept: req.headers['accept'] || '*/*',
      Host: targetUrl.host,
    };
    if (body.length) upstreamHeaders['Content-Length'] = body.length;

    const upstream = https.request(
      {
        method: req.method,
        hostname: targetUrl.hostname,
        port: 443,
        path: targetUrl.pathname + targetUrl.search,
        headers: upstreamHeaders,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, {
          'Content-Type': upstreamRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      console.error('upstream error:', err);
      json(res, 502, { error: 'upstream error', message: err.message });
    });
    if (body.length) upstream.write(body);
    upstream.end();
  });
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  // 健康检查（无需口令）
  if (pathname === '/health' || pathname === '/') {
    return json(res, 200, { ok: true, service: 'agent-plan-proxy', tokenRequired: !!APP_TOKEN, backupMounted: backupMounted() });
  }

  // 口令校验：设置了 APP_TOKEN 时，其余接口必须带 Bearer <口令>
  if (APP_TOKEN) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers['authorization'] || '');
    if (!m || m[1].trim() !== APP_TOKEN) return json(res, 401, { error: { message: '口令不对，请在 App「设置 → 口令 / API Key」里填写正确口令' } });
  }

  // 云备份（必须配置了口令才开放，否则任何人都能读写备份）
  if (pathname.startsWith('/api/backup')) {
    if (!APP_TOKEN) return json(res, 503, { error: { message: '函数未配置 APP_TOKEN 口令，云备份已关闭' } });
    if (!backupMounted()) return json(res, 503, { error: { message: 'TOS 未挂载，云备份不可用（检查函数「存储」配置）' } });
    const parts = pathname.split('/').filter(Boolean).slice(2); // 去掉 api, backup
    try {
      return await handleBackup(req, res, parts);
    } catch (err) {
      console.error('backup error:', err);
      return json(res, 500, { error: { message: `备份接口出错：${err.message}` } });
    }
  }

  // 兼容 OpenAI SDK base URL 探测
  if (req.method === 'GET' && pathname === '/api/plan/v3') {
    return json(res, 200, { object: 'list', data: [{ id: 'ark-code-latest', object: 'model', owned_by: 'volcengine' }] });
  }
  if (req.method === 'GET' && pathname === '/api/plan/v3/models') {
    return json(res, 200, {
      object: 'list',
      data: [
        { id: 'ark-code-latest', object: 'model', owned_by: 'volcengine' },
        { id: 'doubao-seed-2.0-mini', object: 'model', owned_by: 'volcengine' },
      ],
    });
  }
  if (!pathname.startsWith('/api/plan')) {
    return json(res, 404, { error: 'not found', url: req.url, hint: 'use /api/plan/v3/chat/completions' });
  }
  proxyArk(req, res);
});

server.listen(PORT, () => {
  console.log(`[agent-plan-proxy] listening on ${PORT}, upstream: ${ARK_BASE_URL}, token: ${APP_TOKEN ? 'on' : 'off'}, backup: ${BACKUP_DIR}`);
});
