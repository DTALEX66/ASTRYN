/**
 * 星栖开发宿主的服务端兼容代理（仅开发环境）。
 *
 * 目的：让浏览器永远不接触模型密钥。密钥只存在于本进程的环境变量里，
 * 由开发者自行配置；本文件不包含任何凭据，也不会被写入 Git。
 *
 * 约束（对应启动任务第 7 节与 T06）：
 * - 只绑定 loopback；不是开放代理，只转发到 ASTRYN_DEV_MODEL_BASE_URL 配置的单一上游。
 * - 限制请求体大小与超时，不记录请求正文与响应正文。
 * - 上游未配置时返回 503 MODEL_UNAVAILABLE，由界面明确显示，不做任何脚本兜底。
 *
 * 用法：npm run dev:proxy
 *   环境变量在 shell 中 export（npm script 不自动加载 .env 文件；需要直接读 .env 可显式运行
 *   node --env-file-if-exists=.env dev-host/server/dev-model-proxy.mjs，需 Node ≥22.9）：
 *   ASTRYN_DEV_MODEL_BASE_URL  例如 https://api.<provider>/v1
 *   ASTRYN_DEV_MODEL_API_KEY   上游凭据（不会被回传给浏览器）
 *   ASTRYN_DEV_MODEL           模型标识
 *   ASTRYN_DEV_PROXY_PORT      默认 8791
 *   ASTRYN_DEV_MODEL_TIMEOUT_MS 上游超时，默认 30000
 */

import { createServer } from 'node:http';

const HOST = '127.0.0.1';
const PORT = Number(process.env.ASTRYN_DEV_PROXY_PORT ?? 8791);
const BASE_URL = (process.env.ASTRYN_DEV_MODEL_BASE_URL ?? '').replace(/\/+$/, '');
const API_KEY = process.env.ASTRYN_DEV_MODEL_API_KEY ?? '';
const MODEL = process.env.ASTRYN_DEV_MODEL ?? '';
const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = Number(process.env.ASTRYN_DEV_MODEL_TIMEOUT_MS ?? 30000);

/**
 * 允许调用本代理的来源。绑到 loopback 只挡住远程访问，
 * 挡不住用户浏览器里任意 localhost 页面（甚至 DNS rebinding）拿我们的凭据去刷配额。
 * 因此对会消耗额度的 POST 强制校验 Origin 白名单；GET /healthz 只读，放宽。
 */
const ALLOWED_ORIGINS = new Set(
  (process.env.ASTRYN_DEV_PROXY_ALLOWED_ORIGINS ?? 'http://127.0.0.1:5183,http://localhost:5183')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
);

const configured = Boolean(BASE_URL && API_KEY && MODEL);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-astryn-evidence-level': 'REAL'
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('REQUEST_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    json(res, configured ? 200 : 503, {
      configured,
      model: configured ? MODEL : null,
      reason: configured ? null : 'MODEL_UNAVAILABLE：未配置 ASTRYN_DEV_MODEL_BASE_URL / ASTRYN_DEV_MODEL_API_KEY / ASTRYN_DEV_MODEL'
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    // 浏览器发 POST 一定带 Origin；非白名单来源直接拒，避免本机任意页面把这里当免费模型代理。
    // 无 Origin（curl / 自动化脚本）视为本地开发调用，放行但不带凭据回显。
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin.length > 0 && !ALLOWED_ORIGINS.has(origin)) {
      json(res, 403, { error: { code: 'PERMISSION_DENIED', message: '该来源不在开发代理白名单内' } });
      return;
    }
    if (!configured) {
      json(res, 503, { error: { code: 'MODEL_UNAVAILABLE', message: '开发代理未配置获准模型；星栖不使用脚本回复冒充 AI。' } });
      return;
    }

    let raw;
    try {
      raw = await readBody(req);
    } catch (error) {
      json(res, 413, { error: { code: String(error.message), message: '请求体超出限制' } });
      return;
    }

    let incoming;
    try {
      incoming = JSON.parse(raw);
    } catch {
      json(res, 400, { error: { code: 'MALFORMED_REQUEST', message: '请求体不是合法 JSON' } });
      return;
    }

    const upstreamUrl = `${BASE_URL}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    // 客户端断开即中止上游。信号必须用 res 的 'close'：Node ≥16 里 req 的 'close'
    // 在请求体读完时就触发（此刻早已读过 readBody），而 res 'close' 在响应完成或
    // 连接提前终止时触发——正常完成时上游流已消费完，abort 无副作用（审计 B3）。
    res.on('close', () => controller.abort());

    try {
      const upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify({ ...incoming, model: incoming.model ?? MODEL, stream: true }),
        signal: controller.signal
      });

      if (!upstream.ok || !upstream.body) {
        // 只回传状态码与短原因，不回传上游正文，避免把内容写进本地日志。
        json(res, 502, { error: { code: 'UPSTREAM_REJECTED', message: `上游返回 ${upstream.status}` } });
        return;
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-astryn-proxy': 'dev-loopback'
      });

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder('utf-8');
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } catch {
      const code = controller.signal.aborted ? 'TIMEOUT' : 'NETWORK';
      if (!res.headersSent) {
        json(res, 502, { error: { code, message: `上游调用失败（${code}）` } });
      } else {
        res.end();
      }
    } finally {
      clearTimeout(timer);
    }
    return;
  }

  json(res, 404, { error: { code: 'NOT_FOUND', message: '开发代理只提供 /healthz 与 /v1/chat/completions' } });
});

server.listen(PORT, HOST, () => {
  const status = configured ? `已配置上游模型：${MODEL}` : 'MODEL_UNAVAILABLE：未配置上游凭据';
  process.stdout.write(`[astryn-dev-proxy] http://${HOST}:${PORT} — ${status}\n`);
  process.stdout.write('[astryn-dev-proxy] 密钥只存在于本进程环境，不会转发给浏览器。\n');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
