/**
 * SPEC-057 原型：MCP 薄适配器（stdio）。
 *
 * 定位（红线）：无状态，只做「转发到 daemon + 补 who」。不持有任何记忆。
 * 记忆写入只能经此适配器的 remember tool，最终落到 daemon 的共享大脑。
 *
 * 身份：启动参数 --agent=claude-code|codex 决定 who 字段，从而在共享记忆库里
 * 区分「哪个厂商的 Agent 写的」。这正是跨厂商中立的可视化依据。
 *
 * 用法：tsx mcp-adapter/index.ts --agent=claude-code
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT_FILE = join(__dirname, '..', 'data', '.port');
const HOST = '127.0.0.1';

/** 解析 --agent= 身份，默认 unknown */
function parseAgent(): string {
  const arg = process.argv.find((a) => a.startsWith('--agent='));
  return arg ? arg.slice('--agent='.length) : 'unknown';
}
const AGENT = parseAgent();

/** 读取 daemon 端口（daemon 启动时写入 data/.port） */
async function daemonBase(): Promise<string> {
  try {
    const port = (await readFile(PORT_FILE, 'utf8')).trim();
    return `http://${HOST}:${port}`;
  } catch {
    throw new Error('找不到 data/.port —— 请先启动 daemon（bun run daemon）');
  }
}

const server = new McpServer({
  name: `cross-agent-memory-${AGENT}`,
  version: '0.0.1',
});

server.registerTool(
  'remember',
  {
    title: '记住一条项目记忆',
    description:
      '把「当时想干什么(intent)」和「改了什么/为什么放弃(evidence)」记入跨 Agent 共享记忆库，供任何 Agent 日后 recall。',
    inputSchema: {
      project: z.string().describe('项目标识（如仓库名或路径 slug）'),
      intent: z.string().describe('当时想干什么'),
      evidence: z.string().describe('改了什么 / 为什么放弃的可溯依据'),
      summary: z.string().optional().describe('一句话摘要（可选）'),
    },
  },
  async ({ project, intent, evidence, summary }) => {
    const base = await daemonBase();
    const resp = await fetch(`${base}/remember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, who: AGENT, intent, evidence, summary }),
    });
    const data = (await resp.json()) as { id?: string; error?: string };
    if (!resp.ok) throw new Error(data.error ?? `daemon remember 失败 (${resp.status})`);
    return { content: [{ type: 'text', text: `已记住（id=${data.id}，by ${AGENT}）` }] };
  },
);

server.registerTool(
  'recall',
  {
    title: '回忆项目记忆',
    description: '按 query 从跨 Agent 共享记忆库取回该项目做过/试过/放弃过什么。',
    inputSchema: {
      project: z.string().describe('项目标识'),
      query: z.string().describe('要回忆什么（关键词）'),
      limit: z.number().optional().describe('返回条数上限，默认 10'),
    },
  },
  async ({ project, query, limit }) => {
    const base = await daemonBase();
    const u = new URL(`${base}/recall`);
    u.searchParams.set('project', project);
    u.searchParams.set('query', query);
    u.searchParams.set('who', AGENT);
    if (limit) u.searchParams.set('limit', String(limit));
    const resp = await fetch(u);
    const data = (await resp.json()) as { results?: unknown[]; error?: string };
    if (!resp.ok) throw new Error(data.error ?? `daemon recall 失败 (${resp.status})`);
    const results = data.results ?? [];
    return {
      content: [
        {
          type: 'text',
          text:
            results.length === 0
              ? `没有回忆到与「${query}」相关的记忆`
              : `回忆到 ${results.length} 条：\n${JSON.stringify(results, null, 2)}`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stdio server 连接后静默运行；日志走 stderr 不干扰 stdio 协议
console.error(`[adapter:${AGENT}] MCP stdio server 就绪，转发至 daemon`);
