# SPEC-057 原型：跨 Agent 中立记忆层

> **探索/原型验证代码，隔离于主项目，评审前不合入 `extensions/`、`packages/desktop/`。**
> 对应规范：[`../../.specify/specs/057-cross-agent-memory-prototype/`](../../.specify/specs/057-cross-agent-memory-prototype/)

验证一个核心假设：

> **换任何一个 Agent，它都能立刻想起在这个项目上做过什么、试过什么、为什么放弃。**

踩中大厂结构性做不了的三点：**跨厂商中立**（换 Agent 也记得）、**本地优先**（数据在本机）、**记忆/证据层**（带 who/when/intent/evidence）。

## 架构：一个「共享大脑」+ 薄适配器

```
Claude Code ──stdio──▶ MCP Adapter(--agent=claude-code) ─┐
                                                          ├─ localhost HTTP ─▶ Memory Daemon（唯一共享大脑）
Codex       ──stdio──▶ MCP Adapter(--agent=codex)       ─┘                    ├ 记忆库 data/memory.jsonl
                                                                               ├ 调用流 data/calls.jsonl
                                                                               └ Web 观测页（只读）
```

- **MCP 适配器无状态**，只转发 + 补 `who`。记忆写入只能经 `remember` tool。
- **daemon 是唯一持有状态的进程**，两个不同厂商适配器指向同一个它 → 「共享同一个大脑」是架构事实。
- **观测页只读**，无任何写记忆入口。

## 目录

| 路径 | 作用 |
| --- | --- |
| `daemon/` | 共享大脑：HTTP API + SSE + 托管观测页；`store.ts` 管 JSONL 读写 |
| `mcp-adapter/` | 薄 stdio MCP server，转发到 daemon |
| `web/index.html` | 只读观测页（记忆库 + 调用流 + 连接状态） |
| `connect/` | 两厂商接入配置样例 |
| `data/` | 本地落盘（gitignored，证明数据不出本地） |
| `verify-m2.ts` / `verify-m3.ts` | 单厂商链路 / 跨厂商闭环验证 |
| `smoke.ts` | store 层最小 smoke test |
| `VERIFICATION.md` | V1~V4 验证记录 |

## 快速开始

```bash
cd prototypes/057-cross-agent-memory

# 1) 起 daemon（共享大脑 + 观测页），端口默认 9057，写入 data/.port
bun run daemon

# 2) 浏览器打开观测页
open http://127.0.0.1:9057/

# 3) 跑跨厂商闭环验证（另开终端）
../../node_modules/.bin/tsx verify-m3.ts
# 观测页会实时亮起 [claude-code] remember → [codex] recall

# smoke（无需 daemon）
bun run smoke
```

## 接真实 Agent（评审现场演示）

- Claude Code：见 [`connect/claude-code.md`](connect/claude-code.md)
- Codex：见 [`connect/codex.toml.sample`](connect/codex.toml.sample)

两者都指向**同一个 daemon**、只是 `--agent` 身份不同。在 Claude Code 里 `remember`，切到 Codex `recall` 取回——观测页可见跨厂商共享。

## 提供给 Agent 的能力（MCP tools）

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `remember` | project, intent, evidence, summary? | 记一条带意图与证据的项目记忆 |
| `recall` | project, query, limit? | 回忆该项目做过/试过/放弃过什么 |

## 边界（本原型明确不做）

企业审计/权限/合规、云同步、向量检索/记忆压缩、观测页写操作、品牌 UI、OpenClaw 接入（其 MCP 配置待验证，为后续扩展点）、任何主模块合入式改动。详见 spec §5。

## 评审后

- 通过 → 另立实施型 spec，定进主项目的模块边界、与上游隔离、A/B/C 落地顺序，补 OpenClaw 实测。
- 否决 → 归档或删除本目录（隔离设计保证可干净移除）。
