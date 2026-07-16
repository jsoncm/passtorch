/**
 * SPEC-057 M2 验证：通过真实 MCP 协议驱动适配器，验证「Agent → 适配器 → daemon」链路。
 * 用 SDK 自带 Client + StdioClientTransport 模拟一个 Agent，spawn --agent=claude-code 适配器。
 *
 * 前置：先启动 daemon（bun run daemon）。
 * 运行：tsx verify-m2.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = 'm2-verify-proj';

async function main() {
  const transport = new StdioClientTransport({
    command: join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx'),
    args: [join(__dirname, 'mcp-adapter', 'index.ts'), '--agent=claude-code'],
  });
  const client = new Client({ name: 'm2-test-agent', version: '0.0.1' });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log('[M2] 适配器暴露的 tools:', tools.tools.map((t) => t.name).join(', '));

  const remembered = await client.callTool({
    name: 'remember',
    arguments: {
      project: PROJECT,
      intent: '验证 MCP 适配器能把 remember 转发到 daemon',
      evidence: '通过 StdioClientTransport 模拟 Agent 调用',
      summary: 'M2 单厂商链路验证',
    },
  });
  console.log('[M2] remember 返回:', JSON.stringify(remembered.content));

  const recalled = await client.callTool({
    name: 'recall',
    arguments: { project: PROJECT, query: 'MCP 适配器' },
  });
  const text = (recalled.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  console.log('[M2] recall 返回:', text.slice(0, 200));

  const ok = text.includes('M2 单厂商链路验证') || text.includes('转发到 daemon');
  await client.close();
  console.log(ok ? '\n✅ M2 通过：Agent → 适配器 → daemon 链路成立' : '\n❌ M2 失败：recall 未取回写入内容');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ M2 异常:', err);
  process.exit(1);
});
