/**
 * SPEC-057 M3 验证 ★生死点：跨厂商中立闭环（V1）。
 *
 * 用两个独立的 MCP client + 适配器进程，身份分别为 claude-code 与 codex，
 * 共享同一个 daemon，验证：claude-code remember 的记忆，codex 能 recall 取回。
 *
 * 这是对「换厂商 Agent 也能想起」这一核心假设的架构层验证。
 * 真实 Claude Code / Codex 二进制接入见 connect/*.md（配置 --agent 身份即可）。
 *
 * 前置：先启动 daemon（bun run daemon）。
 * 运行：tsx verify-m3.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSX = join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx');
const ADAPTER = join(__dirname, 'mcp-adapter', 'index.ts');
const PROJECT = 'cross-vendor-demo';

/** 用指定厂商身份启动一个「Agent」（MCP client + 适配器进程） */
async function spawnAgent(agent: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: TSX,
    args: [ADAPTER, `--agent=${agent}`],
  });
  const client = new Client({ name: `${agent}-sim`, version: '0.0.1' });
  await client.connect(transport);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return (content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
}

async function main() {
  console.log('=== M3 跨厂商中立闭环验证（★生死点）===\n');

  // —— 厂商 A：Claude Code 记下一条 ——
  const claude = await spawnAgent('claude-code');
  const secret = '放弃 WebSocket 改用 SSE 做调用流推送';
  await claude.callTool({
    name: 'remember',
    arguments: {
      project: PROJECT,
      intent: '为观测页选实时推送方案',
      evidence: secret,
      summary: secret,
    },
  });
  console.log('① [claude-code] remember：', secret);
  await claude.close(); // 完全关闭厂商 A，模拟"换 Agent"
  console.log('   （已关闭 Claude Code 适配器进程）\n');

  // —— 厂商 B：Codex 回忆 ——
  const codex = await spawnAgent('codex');
  const recalled = await codex.callTool({
    name: 'recall',
    arguments: { project: PROJECT, query: 'WebSocket SSE 推送' },
  });
  const text = textOf(recalled);
  console.log('② [codex] recall：\n', text.slice(0, 400), '\n');
  await codex.close();

  // —— 判据：Codex 取回了 Claude Code 写的内容，且来源标注为 claude-code ——
  const gotContent = text.includes(secret);
  const gotOrigin = text.includes('"who": "claude-code"') || text.includes('claude-code');
  const pass = gotContent && gotOrigin;

  console.log('判据：');
  console.log(`  - Codex 取回了 Claude Code 写的内容: ${gotContent ? '✅' : '❌'}`);
  console.log(`  - 记忆来源标注为 claude-code:         ${gotOrigin ? '✅' : '❌'}`);
  console.log(
    pass
      ? '\n✅ M3 通过：核心假设成立——换厂商 Agent（claude-code → codex）也能想起。'
      : '\n❌ M3 失败：跨厂商未取回。原型证伪，按 tasks.md 停 M4/M5 进否决评审。',
  );
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ M3 异常:', err);
  process.exit(1);
});
