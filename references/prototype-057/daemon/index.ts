/**
 * SPEC-057 原型：Memory Daemon —— 唯一持有状态的"共享大脑"。
 *
 * 职责：
 * - remember/recall 本地 HTTP API（Agent 经 MCP 适配器调用）。
 * - GET /entries、GET /stream(SSE)、静态托管 web 观测页（只读观测）。
 *
 * 本地优先：只监听 127.0.0.1，数据只落 ../data/*.jsonl，不发起任何外部网络请求。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendMemory, appendCall, recall, readAllMemories, readAllCalls } from './store.js';
import type { RememberInput } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT_FILE = join(__dirname, '..', 'data', '.port');
const WEB_FILE = join(__dirname, '..', 'web', 'index.html');
const HOST = '127.0.0.1';
const BASE_PORT = 9057; // 9000+ 段，避开主项目常用端口

/** SSE 客户端连接池（M4 观测页用；M1 先建好广播骨架） */
const sseClients = new Set<ServerResponse>();

/** 向所有观测页广播一个事件 */
export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

function isRememberInput(v: unknown): v is RememberInput {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.project === 'string' &&
    typeof o.who === 'string' &&
    typeof o.intent === 'string' &&
    typeof o.evidence === 'string'
  );
}

async function handleRemember(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  if (!isRememberInput(body)) {
    sendJson(res, 400, { error: 'remember 需要 project/who/intent/evidence 四个非空字符串' });
    return;
  }
  const entry = await appendMemory(body);
  const call = {
    ts: new Date().toISOString(),
    agent: entry.who,
    op: 'remember' as const,
    hitId: entry.id,
    queryOrIntent: entry.intent,
  };
  await appendCall(call);
  broadcast('call', call);
  broadcast('memory', entry);
  sendJson(res, 200, { id: entry.id });
}

async function handleRecall(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const project = url.searchParams.get('project') ?? '';
  const query = url.searchParams.get('query') ?? '';
  const limit = Number(url.searchParams.get('limit') ?? '10') || 10;
  if (!project) {
    sendJson(res, 400, { error: 'recall 需要 project 查询参数' });
    return;
  }
  const results = await recall(project, query, limit);
  const agent = url.searchParams.get('who') ?? 'unknown';
  const call = {
    ts: new Date().toISOString(),
    agent,
    op: 'recall' as const,
    hitId: results[0]?.id,
    queryOrIntent: query,
  };
  await appendCall(call);
  broadcast('call', call);
  sendJson(res, 200, { results });
}

/** GET /entries —— 观测页初始快照：全部记忆 + 全部调用流 */
async function handleEntries(res: ServerResponse): Promise<void> {
  const [memories, calls] = await Promise.all([readAllMemories(), readAllCalls()]);
  sendJson(res, 200, { memories, calls });
}

/** GET /stream —— SSE：Agent 每次 remember/recall 实时推给观测页 */
function handleStream(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('event: ready\ndata: {}\n\n');
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

/** GET / —— 托管只读观测页（静态 HTML） */
async function handleWeb(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(WEB_FILE, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    res.writeHead(404);
    res.end('观测页未找到（web/index.html）');
  }
}

async function router(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  try {
    if (req.method === 'POST' && url.pathname === '/remember') return await handleRemember(req, res);
    if (req.method === 'GET' && url.pathname === '/recall') return await handleRecall(req, res, url);
    if (req.method === 'GET' && url.pathname === '/entries') return await handleEntries(res);
    if (req.method === 'GET' && url.pathname === '/stream') return handleStream(res);
    if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/') return await handleWeb(res);
    sendJson(res, 404, { error: `未知路由 ${req.method} ${url.pathname}` });
  } catch (err) {
    sendJson(res, 500, { error: String(err instanceof Error ? err.message : err) });
  }
}

/** 端口占用则向上递增，找到可用端口后把端口号写入 data/.port 供适配器读取 */
function listenWithFallback(port: number, attemptsLeft = 20): void {
  const server = createServer((req, res) => void router(req, res));
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      listenWithFallback(port + 1, attemptsLeft - 1);
    } else {
      console.error('[daemon] 启动失败:', err);
      process.exit(1);
    }
  });
  server.listen(port, HOST, async () => {
    await writeFile(PORT_FILE, String(port), 'utf8');
    console.log(`[daemon] 共享大脑已启动 http://${HOST}:${port}  (端口已写入 data/.port)`);
  });
}

listenWithFallback(BASE_PORT);
