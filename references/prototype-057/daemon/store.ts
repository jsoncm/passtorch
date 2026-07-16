/**
 * SPEC-057 原型：记忆库 + 调用流的 JSONL 落盘读写。
 *
 * 设计要点：
 * - 记忆库(memory.jsonl) 与 调用流(calls.jsonl) 各一个 append-only 文件，纯文本可 `cat`。
 * - 所有写入经 daemon 单进程，用内部串行队列保证 append 顺序，规避并发写冲突（plan §3.2）。
 * - recall 用最简关键词/摘要匹配（原型不做向量检索）。
 */

import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MemoryEntry, CallLogItem, RememberInput } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const MEMORY_FILE = join(DATA_DIR, 'memory.jsonl');
const CALLS_FILE = join(DATA_DIR, 'calls.jsonl');

/** 串行写队列：保证多个并发请求的 append 顺序落盘 */
let writeChain: Promise<void> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  // 吞掉链上错误，避免一次失败阻断后续写入
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

/** 生成稳定 id：时间戳 + 随机后缀（原型够用） */
function genId(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 读取全部记忆条目 */
export async function readAllMemories(): Promise<MemoryEntry[]> {
  await ensureDataDir();
  if (!existsSync(MEMORY_FILE)) return [];
  const raw = await readFile(MEMORY_FILE, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as MemoryEntry);
}

/** 读取全部调用流 */
export async function readAllCalls(): Promise<CallLogItem[]> {
  await ensureDataDir();
  if (!existsSync(CALLS_FILE)) return [];
  const raw = await readFile(CALLS_FILE, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CallLogItem);
}

/** 写一条记忆：补 id/when，串行 append */
export async function appendMemory(input: RememberInput): Promise<MemoryEntry> {
  return serialize(async () => {
    await ensureDataDir();
    const entry: MemoryEntry = {
      id: genId(),
      project: input.project,
      who: input.who,
      when: new Date().toISOString(),
      intent: input.intent,
      evidence: input.evidence,
      summary: input.summary?.trim() || input.intent,
      tags: input.tags,
    };
    await appendFile(MEMORY_FILE, JSON.stringify(entry) + '\n', 'utf8');
    return entry;
  });
}

/** 追加一条调用流日志 */
export async function appendCall(item: CallLogItem): Promise<void> {
  return serialize(async () => {
    await ensureDataDir();
    await appendFile(CALLS_FILE, JSON.stringify(item) + '\n', 'utf8');
  });
}

/**
 * 最简 recall：按 project 过滤后，用 query 的空格分词对 intent/evidence/summary/tags
 * 做大小写不敏感的包含打分，按命中分数与时间倒序返回。
 */
export async function recall(project: string, query: string, limit = 10): Promise<MemoryEntry[]> {
  const all = await readAllMemories();
  const inProject = all.filter((m) => m.project === project);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) {
    // 无 query 词：返回该项目最近若干条
    return inProject.slice(-limit).reverse();
  }

  const scored = inProject
    .map((m) => {
      const hay = `${m.intent}\n${m.evidence}\n${m.summary}\n${(m.tags ?? []).join(' ')}`.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
      return { m, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.m.when.localeCompare(a.m.when));

  return scored.slice(0, limit).map((s) => s.m);
}
