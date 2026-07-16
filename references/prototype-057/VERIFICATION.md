# SPEC-057 原型验证记录

对照 [`../.specify/specs/057-cross-agent-memory-prototype/plan.md`](../../.specify/specs/057-cross-agent-memory-prototype/plan.md) §8 验证方案与 spec §7 DoD。

- 验证日期：2026-07-15
- 记忆库：JSONL；跨厂商演示：Claude Code + Codex（架构层用两个不同 `--agent` 身份的适配器进程验证）

## 验证结果总览

| 编号 | 验证项 | 结果 | 依据 |
| --- | --- | --- | --- |
| **V1** | 跨厂商中立（★核心） | ✅ 通过 | `verify-m3.ts`：`--agent=claude-code` remember → 关闭 → `--agent=codex` recall 取回同一条，`who=claude-code` |
| **V1-真机** | 跨厂商中立·真实 CLI（★★最强证据） | ✅ 通过 | 真实 Claude Code remember → 真实 Codex recall 取回并**明确表态不重踩坑**。详见下方「V1-真机」章节 |
| **V2** | 本地优先 | ✅ 通过 | 全原型 http 目标仅 `127.0.0.1`；无任何外部网络地址；数据只落 `data/*.jsonl` |
| **V3** | 证据完整性（企业地基） | ✅ 通过 | 落盘记忆 `who/when/intent/evidence` 四字段均非空，`who` 可区分厂商来源 |
| **V4** | 观测页只读性 | ✅ 通过 | `web/index.html` 无 POST/PUT/DELETE、无新建/编辑/删除入口；仅 `GET /entries` + `EventSource /stream` |
| smoke | store 往返 | ✅ 全绿 | `smoke.ts`：8 项断言全过（含 project 隔离） |

## 关键说明：架构层验证 vs 真实二进制

- 真实的 Claude Code / Codex CLI 需交互式登录，无法在自动化脚本里驱动。
- V1 在 **MCP 协议层**用两个独立的适配器进程（身份 `--agent=claude-code` 与 `--agent=codex`）共享同一 daemon，忠实复现「换厂商 Agent」场景——**验证的正是核心假设的架构根据**（不同身份适配器共享同一个大脑）。
- **V1-真机（下方）已用真实二进制补齐这一层**：真实 Claude Code 与真实 Codex CLI 各自由模型自主驱动，跑通同一闭环，证据强度高于脚本模拟。
- 真实二进制接入只是配置 `--agent` 身份的一步，见 `connect/claude-code.md`、`connect/codex.toml.sample`、`MANUAL-TEST.md`。

## V1-真机：真实 Claude Code + 真实 Codex 跨厂商闭环（★★最强证据）

- 验证日期：2026-07-15
- 场景：`MANUAL-TEST.md` ★Case B。演示项目 `prototypes/demo-auth/`（`.mcp.json` 身份 `--agent=claude-code`；Codex 侧 `~/.codex/config.toml` 身份 `--agent=codex`）。
- 与 V1 的区别：V1 由脚本按死值调工具；**V1-真机由两家厂商的真实模型各自决定何时调、用什么检索词调**。

### 闭环事实（原始落盘坐实）

1. **真实 Claude Code** `remember` 一条限流决策 → 落盘 `mem_mrlolnav_e1t81p`，`who=claude-code`，`when=2026-07-15T06:10:43.639Z`。
2. 关闭 Claude Code（模拟换厂商），约 7 分钟后启动 **真实 Codex**。
3. **真实 Codex** 三次 `recall`（查询词均为 Codex 模型自主生成，非 prompt 给定）：
   - `06:17:42` `登录 注册 验证码 密码重试 防爆破 限频 IP 用户 代理` — 未命中（词偏鉴权）
   - `06:17:46` `接口限流 rate limit throttling 429 之前踩坑 方案 决策` — **命中** `mem_mrlolnav_e1t81p`
   - `06:17:49` `Redis 内存 多实例 限流 中间件 trusted proxy X-Forwarded-For` — **命中** 同一条
4. Codex 最终结论原文：**「后续不要重新采用进程内 token bucket，应直接基于 Redis 设计。」**

### 三条判据核验（全部实证成立）

| 判据 | 结果 | 依据 |
| --- | --- | --- |
| Codex 无提示下说出「token bucket 多进程失效/已放弃/改 Redis」 | ✅ 实证 | Codex 结论原文复述了放弃原因与 Redis 方向（见上第 4 点） |
| Codex 没反建议进程内 token bucket（没重踩坑） | ✅ 实证 | 结论明确「不要重新采用进程内 token bucket」——从"取到记忆"升级为"用对记忆" |
| who=claude-code 的记忆被 codex 取回 | ✅ 铁证 | `calls.jsonl`：`agent=codex, op=recall, hitId=mem_mrlolnav_e1t81p`，该 id 记忆 `who=claude-code` |

### 为什么这是最强证据

Codex 的检索词（`429`、`X-Forwarded-For`、`trusted proxy`）**均未出现在用户 prompt 中**，是模型围绕"限流"自主发散、并在首次未命中后**改写查询才命中**。这个「试错→改写→命中→表态」的轨迹，证明发起调用的是真实模型的自主决策，而非脚本按死值调用——这是脚本版 V1 无法提供的说服力。

### 面板一致性

观测台面板（右栏记忆卡五字段、左栏 4 条调用流水）与 `data/memory.jsonl` / `data/calls.jsonl` 原始落盘逐字一致，渲染层无虚构、无丢失。

## 复现命令

```bash
cd prototypes/057-cross-agent-memory

# smoke（无需 daemon）
bun run smoke

# 起 daemon（共享大脑 + 观测页）
bun run daemon

# 另开终端：跑 V1 跨厂商闭环
../../node_modules/.bin/tsx verify-m3.ts

# 浏览器打开观测页（端口见 data/.port，默认 9057）
open http://127.0.0.1:9057/
```

## 结论

原型达成 spec §7 全部 DoD：V1~V4 通过、smoke 绿、四字段地基就位、观测页只读。
**核心假设「换任何 Agent 都能想起在本项目做过/试过/放弃过什么」不仅在架构层（V1）成立，更已由真实 Claude Code + 真实 Codex 二进制（V1-真机）实证闭环**——跨厂商取回后 Codex 明确表态不重踩坑。
可进入「是否进主项目」的决策评审。
