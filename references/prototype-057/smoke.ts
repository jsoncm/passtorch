/**
 * SPEC-057 最小 smoke test —— 仅防演示翻车，不追覆盖率（豁免主项目测试规约）。
 * 只验证 store 层 remember→recall 往返、四字段一致。用临时 project 隔离，不污染演示数据。
 *
 * 运行：bun run smoke  （或 tsx smoke.ts）
 */

import { appendMemory, recall, readAllMemories } from './daemon/store.js';

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✅ ${msg}`);
  } else {
    console.error(`  ❌ ${msg}`);
    failed++;
  }
}

async function main() {
  console.log('=== SPEC-057 store smoke test ===');
  const project = `smoke-${Date.now()}`;

  const entry = await appendMemory({
    project,
    who: 'smoke-agent',
    intent: '验证 store 往返',
    evidence: '写入后应能按关键词取回，四字段一致',
    summary: 'store 往返 smoke',
  });

  assert(!!entry.id, 'appendMemory 返回 id');
  assert(!!entry.when, 'when 自动填充');
  assert(entry.who === 'smoke-agent', 'who 保留');

  const hits = await recall(project, '往返 取回');
  assert(hits.length === 1, 'recall 命中 1 条');
  const m = hits[0];
  assert(m?.intent === '验证 store 往返', 'intent 往返一致');
  assert(m?.evidence.includes('四字段一致'), 'evidence 往返一致');

  // 隔离性：不同 project 不串
  const other = await recall(`nope-${Date.now()}`, '往返');
  assert(other.length === 0, '按 project 隔离，不串数据');

  const all = await readAllMemories();
  assert(all.some((x) => x.id === entry.id), 'readAllMemories 含刚写入条目');

  console.log(failed === 0 ? '\n✅ smoke 全绿' : `\n❌ smoke 失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke 异常:', err);
  process.exit(1);
});
