# SPEC-058 Tasks：独立开源项目 v1 里程碑清单

> 对应 [`spec.md`](./spec.md) 与 [`plan.md`](./plan.md)。
> **⚠️ 本 spec 是「再决策型」——以下所有任务在评审拍板「建独立仓库」之前不执行。**
> 评审通过后，本清单转「可执行」，另立建仓 / 发布工单，按 P0~P7 推进。

- **状态**：📝 待评审（评审决定是否建仓 → 通过后才转可执行）
- **已定案**（2026-07-16）：项目名 = **`passtorch`**；建仓落点 = workspace 平级 **`~/per-wspace/oss/passtorch/`**（详见 spec 头部「已定案」、plan §7 与 §附）。故 G.2 收敛为「追认」、N 收敛为「占用核查 + 兜底变体」，非「重新拍名」。
- **生死点**：**P3（daemon 生命周期）**——自启动 / 单例做不稳，「零摩擦」卖点即塌，原型的手动 daemon 正是不能直接发布的原因。

---

## 评审门（M-GATE，先于所有 P 任务）

- [ ] **G.1** 评审 spec §8 三问：是否建独立开源仓库 / v1 范围（MUST·SHOULD·DEFER）是否成立 / open-core 切分红线是否认同
- [ ] **G.2** 追认命名与建仓已定案（名 = `passtorch`；落点 = `~/per-wspace/oss/passtorch/`）——已定案，评审只需确认无异议，无需再拍名
- [ ] **G.3** 决策记录归档；**通过 → 另立建仓工单，本清单转可执行；否决 → 记录结论，原型留 SPEC-057 隔离区或归档**

> G.1~G.3 未通过前，P0~P7 全部冻结。

---

## 命名 / 建仓落定核查（N，评审后、P0 前）

> 名与落点已定案（`passtorch` @ `~/per-wspace/oss/passtorch/`），本组只做占用核查与目录就位，非重新拍名。

- [x] **N.1** 查 npm 包名占用（`npm view passtorch`）；被占则退兜底变体（`passtorch-mcp` / `agent-passtorch`，不改火炬叙事）并回填终名
- [ ] **N.2** 查 GitHub org/repo 名 `passtorch` 可用性 + 域名（可选）
- [ ] **N.3** 在 workspace 根建 `~/per-wspace/oss/` 目录，确认 `oss/passtorch/` 落点与商业仓库平级、独立 git（不纳入 `ecs_agentdrive_client` 版本库）

---

## 里程碑总览（评审通过后执行）

```
P0 仓库骨架 ──▶ P1 store+schema ──▶ P2 daemon(HTTP/SSE/观测页托管)
                                        │
                                        ▼
                          P3 ★daemon 生命周期(lock/单例/自启)  ← 生死点
                                        │
                                        ▼
        P4 项目识别+config ──▶ P5 MCP server(一行接入) ──▶ P6 三厂商文档+观测页硬化
                                        │
                                        ▼
                          P7 测试+CI+README+社区物料 ──▶ npm publish 0.1.0
```

---

## P0 — 仓库骨架（纯 Node 产物基座）

- [ ] **T0.1** 于 `~/per-wspace/oss/passtorch/` `git init` 独立仓库；MIT `LICENSE`；`package.json`（`name:passtorch`、`type:module`、`bin` 指 `dist/bin.js`、shebang）
- [ ] **T0.2** TS + `tsup`/`tsc` 构建，产物**纯 JS、`node` 直跑**（零 bun 依赖）；开发脚本可用 bun
- [ ] **T0.3** `env-paths` 解析跨平台数据 / 配置目录（plan §2.1）
- [ ] **T0.4** `bin.ts` 入口：裸调用 → server 模块；有子命令 → 惰性 import commander（热路径保护，plan §1.1）

**产出验证**：`npx .` 能跑起一个 hello server；`node dist/bin.js status` 能进 CLI 分支。

---

## P1 — store 抽象 + schema

- [ ] **T1.1** 定义 `MemoryEntry`（四字段必填 + `scope?/ttl?` 预留占位）与 `CallLogItem`（plan §4.2）
- [ ] **T1.2** `MemoryStore` 接口 + `JsonlStore` 实现（迁原型：串行 append 队列 + 关键词打分 recall）
- [ ] **T1.3** 数据落**用户级目录**（非包目录），memory.jsonl / calls.jsonl

**产出验证**：单测 remember→recall 四字段往返一致；`cat` 用户目录 jsonl 可见。

---

## P2 — daemon（HTTP + SSE + 观测页托管）

- [ ] **T2.1** HTTP 端点：`POST /remember`、`GET /recall`、`GET /entries`、`GET /stream`(SSE)、`GET /health`(带 token+version)、`POST /shutdown`
- [ ] **T2.2** 只监听 `127.0.0.1`；端口占用向上递增（plan §9）
- [ ] **T2.3** 托管静态 `web/index.html`
- [ ] **T2.4** 写入统一经 daemon 单进程串行落盘（规避并发冲突）

**产出验证**：`curl` 打通 remember/recall/health；浏览器开观测页看到记忆库。

---

## P3 — ★daemon 生命周期（生死点：lock / 单例 / 自启 / 端口发现）

> 依赖 P2。详设见 [p3-daemon-lifecycle.md](./p3-daemon-lifecycle.md) 与 plan §2。做不稳则整个「零摩擦」卖点塌。

- [ ] **T3.1** `daemon.lock` 原子写（临时文件 + rename）+ 字段（pid/port/token/version/startedAt，plan §2.3）
- [ ] **T3.2** `isDaemonAlive` 三段探活（解析 → pid → health+token，plan §2.4）
- [ ] **T3.3** 启动竞态状态机：`O_EXCL` 抢锁 + 双重检查 + 抢输者等就绪（plan §2.5）
- [ ] **T3.4** detached spawn + 就绪轮询（指数退避、8s 超时，plan §2.6）
- [ ] **T3.5** 陈旧锁判定与抢占清理（自愈，plan §2.4/2.9）
- [ ] **T3.6** 版本漂移策略：主版本不等才换代（plan §2.7）
- [ ] **T3.7** 失败兜底文案 + `status`/`stop` 子命令（plan §2.8）
- [ ] **T3.8** 竞态测试全表（plan §2.10：并发 5 server 只起 1 daemon 等 7 例）

**产出验证**：plan §2.10 七个用例全绿——尤其「并发 5 server 恰好 1 daemon」「杀 daemon 后握手自愈且数据不丢」。

---

## P4 — 项目自动识别 + config

- [ ] **T4.1** `project` 缺省推导：git-root 目录名+短 hash → cwd 目录名 → `default`（plan §3）
- [ ] **T4.2** server 把 cwd 带给 daemon，daemon 统一推导（同仓库命中同 `project` 键）
- [ ] **T4.3** config：dataDir / port / aliases / `telemetry:false`（plan §6 配套）

**产出验证**：同一仓库不同 Agent 调用命中同 project；alias 可读名生效。

---

## P5 — MCP server（第二套界面，一行接入）

- [ ] **T5.1** stdio MCP server（官方 SDK），暴露 `remember` / `recall`（+ `list` SHOULD）
- [ ] **T5.2** `--agent=` 身份 → 自动填 `who`；无状态，只转发到 daemon（红线：不持有记忆）
- [ ] **T5.3** server 启动时透明握手确保 daemon 在跑（接 P3）
- [ ] **T5.4** 工具错误返回人类可读文案（接 plan §2.8）

**产出验证**：MCP 配置写一行 `command: npx` → Agent 能 remember/recall，全程不手动起 daemon。

---

## P6 — 三厂商接入文档 + 观测页硬化

- [ ] **T6.1** `connect/` 三厂商样例：Claude Code（`.mcp.json`/`claude mcp add`）、Codex（`~/.codex/config.toml`）、Cursor
- [ ] **T6.2** 观测页加「数据 100% 本地·零遥测」信任横幅 + 空态引导（plan §8）
- [ ] **T6.3** 观测页红线自检：无任何新建 / 编辑 / 删除入口（SPEC-057 V4）

**产出验证**：陌生人照 connect 文档复制即通；观测页跑跨厂商时实时亮起。

---

## P7 — 测试 + CI + 社区物料 → 发布

- [ ] **T7.1** 测试矩阵（plan §10）：store 往返 / lifecycle 竞态 / project 推导 / adapter 转发 / e2e smoke
- [ ] **T7.2** CI（GitHub Actions）：lint+typecheck+test+build，mac/linux/win × Node 18/20/22
- [ ] **T7.3** `README`：一句话定位 + 与 mem0 区别 + 30s demo GIF + 快速开始
- [ ] **T7.4** 社区物料：`CONTRIBUTING` / `CODE_OF_CONDUCT` / issue·PR 模板
- [ ] **T7.5** **隐私声明**（数据 100% 本地 / 零遥测）+ **威胁模型**（仅 127.0.0.1 / 无鉴权理由）+ **零管理员授权声明**
- [ ] **T7.6** `npm publish` 0.1.0（带 provenance）+ GitHub Release
- [ ] **T7.7** 提交 MCP registry / awesome-mcp-servers / Claude·Cursor MCP 目录

**产出验证**：陌生人一行装上、三平台跑通跨厂商 recall、CI 绿、可发现——达成 spec §4 发布 DoD。

---

## v1.1 后置（明确不在 v1）

- `.mcpb` bundle（Claude Desktop 一键装 + Connectors Directory 曝光）
- Homebrew tap
- Agent 侧 `forget` / `update`
- daemon 空闲回收（idleTimeout 自退）
- `service install`（用户级常驻，LaunchAgent / systemd --user / 计划任务，免管理员）

---

## 排除项复述（防 scope 蔓延，对齐 spec §3 DEFER）

以下 v1 **明确不做**：向量 / 语义检索、记忆压缩 / TTL / scope 治理（仅预留字段）、**云同步 / 团队共享（属商业线，绝不进开源核心）**、审计 / 权限 / 合规、双轨回滚 / git 集成 / 急救按钮 / 菜单栏托盘、Electron 桌面 App、curl+二进制分发。
