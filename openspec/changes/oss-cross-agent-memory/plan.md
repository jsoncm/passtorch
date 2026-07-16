# SPEC-058 Plan：独立开源项目 v1 技术实施方案

> 对应 [`spec.md`](./spec.md)。**仅技术方案，不含实现代码。** 评审通过后才建独立仓库、写代码。
> 基线继承：纯 Node + npx / MIT + open-core / 全新中立名 / 本地优先（数据不出本地）。

- **状态**：📝 待评审

---

## 0. 基线锁定

| 维度 | 决定 | 对设计的约束 |
| --- | --- | --- |
| 运行时 | **Node ≥ 18**，产物纯 JS | 源码 TS，`tsup`/`tsc` 编译；**产物零 bun 依赖**；开发可用 bun |
| 分发 | **npm + npx** | 需 `bin` 入口 + shebang；支持 `npx passtorch@latest` 免安装 |
| 许可 | **MIT**，open-core | 核心仓库纯本地；云 / 团队 / 审计不进此仓 |
| 品牌 | **`passtorch`**（已定案，§附） | 代码 / 包名 / 观测页不出现 360·AgentDrive·eyun 字样 |
| 建仓 | **workspace 平级 `oss/passtorch/`** | 落 `~/per-wspace/oss/passtorch/`，与商业仓库平级、独立 git（§7） |

---

## 1. 包形态与 npx UX（降到「配一次，永不手动起进程」）

单一 npm 包，一个 `bin`，靠**子命令**分身：

```
passtorch            # 默认 = 以 MCP stdio server 身份运行（Agent 直接 spawn 它）
passtorch daemon     # 显式前台起 daemon（调试用）
passtorch dashboard  # 打开观测页（等价 open http://127.0.0.1:PORT）
passtorch status     # 打印 daemon 状态 / 端口 / 数据目录 / 日志路径
passtorch stop       # 停 daemon（兜底键）
passtorch service install|uninstall   # 可选：注册用户级常驻（免管理员，见 §5）
```

用户最终**只需在 Agent 的 MCP 配置里写一行**（Claude Code 示例）：

```jsonc
{ "mcpServers": { "memory": { "command": "npx", "args": ["-y", "passtorch"] } } }
```

Agent spawn 这个 stdio server → server **透明确保本机 daemon 已在跑**（§2）→ 用户**从不手动开 daemon、从不接触 `.port`**。这是相对原型最关键的体验跃迁。

### 1.1 热路径保护（架构要点）

`bin` 入口**先判断是不是裸 server 调用**：是 → 直接进 server 模块；否 → 才**惰性 import** CLI 框架。因为裸 server 会被 Agent 频繁 spawn，不能为 6 个子命令背 CLI 框架的冷启动成本。

---

## 2. daemon 自启动 / 单例 / 端口发现（v1 核心工程，原型最大缺口）

原型：手动 `bun run daemon` + adapter 读 `data/.port`。产品必须**自愈自启、全局单例**。本节是 P3 详设，更深入的状态机与竞态算法设计见 [p3-daemon-lifecycle.md](./p3-daemon-lifecycle.md)。

### 2.1 运行时目录（跨平台，脱离包安装目录）

数据不能落包目录的 `data/`（npx 安装目录是临时的）。改用**用户级固定目录**（`env-paths` 解析）：

- macOS/Linux：`$XDG_DATA_HOME/passtorch/` 或 `~/.local/share/passtorch/`
- Windows：`%LOCALAPPDATA%\passtorch\`
- 内含：`memory.jsonl` · `calls.jsonl` · `daemon.lock` · `daemon.log`

### 2.2 核心不变式（Invariants）

1. **至多一个 daemon**：一个 `dataDir` 下任意时刻最多一个存活 daemon 监听端口。
2. **自愈**：daemon 崩溃 / 被杀后，下一次 server 握手能重新拉起。
3. **无孤儿锁**：陈旧锁（持有者已死）不能永久阻塞后续启动。
4. **零授权**：全程用户级操作，不碰 sudo / 系统 service / 对外端口。
5. **快速失败**：确实起不来时，返回**人类可读**错误，不 hang 死。

### 2.3 锁文件格式（`daemon.lock`）

`dataDir/daemon.lock`，单行 JSON，**原子写**（写临时文件再 `rename`）：

```jsonc
{
  "schema": 1,
  "pid": 48213,            // daemon pid，用于 OS 层探活
  "port": 9057,            // 实际监听端口（占用递增后的最终值）
  "host": "127.0.0.1",
  "token": "a3f2c9...",    // 每次启动生成的随机 token，校验「锁与进程同源」
  "startedAt": "2026-07-16T08:12:03.114Z",
  "version": "0.1.0",      // daemon 语义版本，用于版本漂移检测
  "ppid": 48090            // 起它的 server pid（仅诊断）
}
```

- **pid** → OS 探活 `process.kill(pid, 0)`。
- **port + token** → 应用层探活：打 `GET /health`，daemon 回自己 token，**必须与锁一致**——防「pid 复用 / 端口被别的进程占」的误判。
- **version** → 版本漂移策略（§2.7）。

### 2.4 探活三段判定（`isDaemonAlive`）

锁存在 ≠ daemon 活着。由快到慢、由弱到强三段，任一失败即判「陈旧」：

```
读锁 → 解析失败/缺字段              → STALE（损坏锁）
     → process.kill(pid,0) 抛 ESRCH → STALE（进程已死）
       （抛 EPERM → 活着但非我所有，保守判 ALIVE-FOREIGN，不抢）
     → GET /health（超时 500ms）
         连接失败/超时               → STALE（进程在但没服务/端口错）
         200 且 token 匹配            → ALIVE ✅
         200 但 token 不匹配          → STALE（端口被别的进程占）
```

**为什么三段**：pid 探活便宜但会被 pid 复用骗；health+token 贵但权威。先快筛，再定论。

### 2.5 启动竞态状态机（多 server 并发冷启动）

最难场景：两个 Agent 几乎同时 spawn server，都发现没 daemon，都想起一个。用 `O_EXCL` 独占创建 + 双重检查解决：

```
                    ┌─────────────────────────────┐
                    │  server 启动，需要 daemon    │
                    └──────────────┬──────────────┘
                                   ▼
                        ┌──────────────────────┐
                 ┌──No──┤ 锁存在?              │
                 │      └──────────┬───────────┘
                 │                Yes
                 ▼                 ▼
        ┌────────────────┐  ┌──────────────────┐
        │ 尝试 O_EXCL     │  │ isDaemonAlive?    │
        │ 创建 lock       │  └───┬──────────┬────┘
        └───┬────────┬───┘   ALIVE      STALE
         成功      EEXIST      │            │
            │        │         ▼            ▼
            │        │    ┌─────────┐  ┌──────────────────┐
            │        │    │ 用现有  │  │ 抢占清锁：         │
            │        │    │ port 连 │  │ O_EXCL 删旧+建新   │
            │        │    └─────────┘  │ （谁抢到谁负责起）  │
            │        │                 └────┬────────┬─────┘
            │        │                    抢到      抢输(EEXIST)
            ▼        ▼                      │          │
     ┌──────────┐  ┌────────────────┐       │          ▼
     │ spawn    │  │ 别人正在起：     │◀──────┘   ┌──────────────┐
     │ daemon   │  │ 轮询等锁就绪    │           │ 回到「锁存在」│
     │ detached │  │ （退避重试）    │           │ 分支重判      │
     └────┬─────┘  └───────┬────────┘           └──────────────┘
          │                │
          ▼                ▼
   ┌────────────────────────────┐
   │ 轮询 /health 直到 ALIVE     │
   │ 或超时（§2.6）              │
   └────────────────────────────┘
```

**关键点：**
- **抢锁 = `O_EXCL` 原子创建**（`fs.open(path,'wx')`）。OS 保证只有一个进程成功，天然序列化竞态，**无需第三方文件锁库**。
- **抢到锁的 server 负责 spawn daemon**；抢输的进入「等待就绪」轮询，不重复起。
- **端口由 daemon 定**（占用递增），daemon 就绪后把权威 `port/token/pid` 写回 `daemon.lock`。推荐链路：server 直接把 daemon 作为子进程，拿到端口后由 daemon 自己落锁（链路短，二选一在实现时定）。

### 2.6 spawn 与就绪等待

```
spawn 参数：
  detached: true            // 脱离 server 进程组，server 退出不带走 daemon
  stdio: ['ignore', fd, fd] // stdout/stderr → dataDir/daemon.log（可诊断）
  windowsHide: true         // Windows 不弹黑窗
  child.unref()             // 允许 server 先退出

就绪等待（server 侧）：
  轮询 GET /health，指数退避 50→100→200…，单次上限 500ms
  总超时 8s（冷启动 + 首次磁盘写留足余量）
  成功：health 200 且 token 匹配 → 返回 base URL
  超时：抛 DaemonStartTimeout（§2.8 文案）
```

### 2.7 版本漂移（npx 多版本共存的坑）

npx 用户可能今天 `@0.1.0`、明天 `@latest=0.2.0`——两版本 server 可能连同一老 daemon：

- health 响应带 daemon `version`，server 比对：
  - 主版本一致 → 直接用。
  - daemon 更老、server 更新 → server 触发换代：`POST /shutdown`（daemon 无连接后自退）→ 清锁 → 起新版。
  - daemon 更新、server 更老 → 直接用（新 daemon 向后兼容旧契约），仅日志告警。
- **v1 最简**：只在**主版本不等**时换代，同主版本一律复用，避免频繁重启。

### 2.8 失败兜底与文案（直接影响第一印象）

所有错误**指向下一步动作**，不是栈信息。server 侧作为工具错误 / stderr 返回：

| 场景 | 判定 | 文案（给人看） |
| --- | --- | --- |
| 端口全占满（递增 20 次仍 EADDRINUSE） | daemon 起不来 | `无法在 9057–9077 找到可用端口。用 passtorch --port <PORT> 指定，或 passtorch status 排查。` |
| spawn 就绪超时 | 8s 内 /health 不通 | `记忆守护进程启动超时。查看 <dataDir>/daemon.log；或 passtorch daemon 前台启动看报错。` |
| dataDir 不可写 | 写锁 EACCES/EROFS | `数据目录不可写：<dataDir>。检查权限，或设 PASSTORCH_DATA_DIR 指向可写目录。` |
| 陈旧锁抢占反复失败 | 竞态循环超阈值（5 次） | `daemon 状态不一致，可能有残留进程。运行 passtorch stop 清理后重试。` |
| 版本不兼容且换代失败 | shutdown 老 daemon 失败 | `检测到旧版本 daemon 无法自动升级。运行 passtorch stop 后重试。` |

配套排查子命令：`passtorch status`（打印锁 + 探活 + 端口 + dataDir + 日志）/ `passtorch stop`（kill pid + 清锁）/ `passtorch daemon`（前台看崩溃）。

### 2.9 关闭与清理

- **正常退出**：daemon 收 `SIGTERM` / `POST /shutdown` → 关 HTTP → 清锁（仅当锁 token == 自己）→ 退。
- **崩溃**：锁残留 → 下次握手 §2.4 判 STALE 自动清（自愈）。
- **空闲回收（v1.1）**：记录最后请求时间 + SSE 连接数，`idleTimeout`（如 30min）无请求且无 SSE → 自退清锁。v1 靠 `stop` 兜底。

### 2.10 必测竞态用例

| 用例 | 断言 |
| --- | --- |
| 冷启动单 server | 起且仅起 1 个 daemon，锁字段完整 |
| **并发 5 个 server** | 恰好 1 个 daemon，其余复用同端口 |
| 杀 daemon 后再握手 | 陈旧锁被清、重起 1 个、JSONL 数据不丢 |
| 手动写死 pid 假锁 | 判 STALE 并抢占重起 |
| 外部进程占 9057 | 递增到 9058 起，锁记 9058 |
| token 不匹配的 health | 判 STALE，不误用别人的进程 |
| dataDir 只读 | 快速失败 + §2.8 文案，不 hang |

---

## 3. 项目自动识别（原型缺，Agent 不该猜 slug）

`remember`/`recall` 的 `project` 从**必填**降级为**可选**，缺省时 daemon 侧自动推导：

```
优先级：显式传入 project
     → cwd 向上找最近 .git，取 `git rev-parse --show-toplevel` 目录名 + 短 hash
     → 无 git 则用 cwd 目录名
     → 兜底 "default"
```

- server 把自己 cwd（= Agent 工作目录）带给 daemon，由 daemon 统一推导，保证同仓库无论谁调都命中同一 `project` 键。
- 配置支持 `aliases`（路径 → 稳定 slug），给 project 起可读名。

---

## 4. 存储抽象 + schema

### 4.1 存储收敛到接口（v1 JSONL，留死向量位）

```ts
interface MemoryStore {
  append(input: RememberInput): Promise<MemoryEntry>;
  recall(project: string, query: string, limit?: number): Promise<MemoryEntry[]>;
  readAll(project?: string): Promise<MemoryEntry[]>;
  appendCall(item: CallLogItem): Promise<void>;
  readCalls(project?: string): Promise<CallLogItem[]>;
  // v1.1: update?(id, patch) / forget?(id)
}
```

- v1 交付 `JsonlStore`（沿用原型的串行 append 队列 + 关键词打分 recall，已验证可用）。
- 未来 `SqliteStore` / `VectorStore` 平替，daemon / MCP 层零改动。

### 4.2 schema：四字段必填 + 预留企业地基（占位不实现）

```ts
type MemoryEntry = {
  id: string;
  project: string;
  who: string;        // Agent 身份（+ 未来 git user，属商业层审计）
  when: string;       // ISO8601，daemon 补
  intent: string;     // 必填
  evidence: string;   // 必填
  summary: string;
  tags?: string[];
  scope?: 'session' | 'project' | 'global';  // 预留，v1 不消费
  ttl?: string;                                // 预留，v1 不消费
};
```

`scope/ttl` 只进 schema、不进逻辑——保证 v1.x 上生命周期治理时**不用迁数据**。

---

## 5. 分发矩阵与授权模型（调研结论）

先分清两条轴：**「Agent 怎么跑起 server」≠「用户怎么装工具」**。主路径是 Agent 按需 spawn（用户几乎不「安装」）；辅路径才涉及 npx/brew/curl。

### 5.1 分发渠道（分档，不是全做）

| 渠道 | 定位 | v1 | 理由 |
| --- | --- | --- | --- |
| **npx**（`npx -y passtorch`） | 主分发，不可缺 | ✅ **P0** | MCP server 事实标准；MCP 配置直嵌 `command: npx`，零预装、永远最新、三平台一致 |
| **npm 全局**（`npm i -g`） | CLI 上 PATH + 版本钉死 + 冷启动更快 | ✅ **P0** | 与 npx 互补：CLI 子命令靠它，MCP 配置可改 `command: passtorch` 省解析 |
| **`.mcpb` bundle**（Anthropic 一键装） | Claude Desktop 小白单击装 + 进 Connectors Directory | 🟡 **v1.1** | 2025 Anthropic 推的 MCP Bundle（zip+manifest，原 `.dxt`）；低成本、带官方目录曝光；但只惠及 Claude Desktop |
| **Homebrew** | mac「正经工具」可信度与可发现性 | 🟡 **v1.1** | 感觉原生、可顺带配 LaunchAgent；但 Node 包做 formula/tap 是额外维护，不卡 v1 |
| **curl \| sh** | 无 Node 环境用户装单文件二进制 | 🔴 **暂不做** | 对 Node 工具别扭；curl 下来的二进制在 mac 带 quarantine 被 Gatekeeper 拦，更麻烦。仅当将来编自包含二进制才考虑 |

**结论**：**v1 只做 npx + npm 全局**（近零维护，覆盖 95%）；`.mcpb` / brew 放 v1.1 做曝光；curl+二进制暂缓。

### 5.2 守护进程授权模型（信任卖点，答「要不要系统授权」）

**核心结论：默认零授权。**

**① 按需拉起的 daemon（默认模式）= 三平台零授权。** 它是绑 `127.0.0.1` 的普通用户进程：
- 不需要 root / sudo / 管理员（绑高位端口、写用户目录都是非特权）。
- mac 应用防火墙**不弹窗**（只对*对外*监听弹「允许传入连接」，**回环 `127.0.0.1` 被豁免**）——这也是必须绑 127.0.0.1 而非 0.0.0.0 的又一理由。
- 不触发 Gatekeeper / 公证（只管下载来的 .app / 签名二进制；`node`/`npx` 跑 JS 不受约束）。反过来：一旦走 curl+二进制 / brew-cask，mac 上要签名 + 公证，friction 变大。

**② 只有「开机自启常驻」才涉及授权，且只用「用户级、免管理员」机制：**

| 机制 | 范围 | 要管理员? | 说明 |
| --- | --- | --- | --- |
| **按需 spawn（默认）** | 进程级 | ❌ 无 | daemon 随使用起落，用户完全无感，不配置任何东西 |
| mac **LaunchAgent**（`~/Library/LaunchAgents/`） | 单用户 | ❌ 免 sudo | mac 13+ 弹「后台项目已添加」**告知式**通知（可关），不要密码 |
| Linux **systemd `--user`** | 单用户 | ❌ 免 root | `systemctl --user enable`；登出后仍活需 `loginctl enable-linger` |
| Windows **登录时计划任务** | 单用户 | ❌ 免 UAC | 首选 |
| ~~系统级 LaunchDaemon / Service / systemd 系统单元~~ | 系统级 | ✅ 要 root/UAC | **一律不用** |

**daemon 设计结论：**
1. **默认 = 按需透明拉起，零授权、零常驻配置**（就是 §2 那套）。绝大多数用户**永远不需要常驻**。
2. **常驻 = opt-in，只提供「用户级」方式**：`passtorch service install` 注册 LaunchAgent / systemd --user / 计划任务——**全部免管理员密码**。**永不**要求系统级 service。
3. **写进 README 当信任声明**：「本工具从不索取管理员密码，以你的普通用户身份、仅在 localhost 运行，数据只存你的主目录。」——呼应「本地优先·中立」。

---

## 6. CLI 选型：轻量框架，不手写、不上重框架

先看清不对称事实：**主入口不是 CLI**（裸 `passtorch` = 长驻 stdio JSON-RPC，几乎不解析参数）；CLI 只是 6~8 个**扁平**子命令，无插件、无多层命令树。

| 选项 | 判断 |
| --- | --- |
| 手写 `process.argv` | ❌ 重造 flag/help/错误处理轮子，组合参数 / `--` / 未知命令提示易错，对可信度零加分 |
| **oclif** | ❌ 过重（Heroku/Salesforce 量级），依赖大、冷启动慢；裸 server 热路径被频繁 spawn，不能背胖框架 |
| **commander**（推荐） | ✅ 事实标准、体积小、近零依赖、TS 类型好、人人认得；扁平几命令的完美匹配 |
| **citty**（unjs） | ✅ 备选，ESM-first、子命令惰性加载，追求极致精简可选它 |

**推荐 `commander`；追求极简可换 `citty`。** 配套微库（非框架）：`env-paths`（跨平台目录）、`picocolors`（极小着色）、`zod`（MCP schema 已用）。**别**引 `chalk`+`inquirer`+`ora` 交互全家桶——v1 无交互流程。CLI 是次要触点，别过度打磨。

---

## 7. 独立仓库结构（评审通过后才创建，落点 `~/per-wspace/oss/passtorch/`）

> **建仓策略**：在 workspace 根 `~/per-wspace/` 下建 `oss/` 目录，仓库落 `oss/passtorch/`，与 `ecs_agentdrive_client` / `ecs_agentcore` **平级、独立 git 管理**。物理隔离于商业客户端仓库，天然满足 IP 干净与 open-core 边界。

```
~/per-wspace/oss/passtorch/          # 独立 git 仓库（与商业仓库平级）
├── README.md / LICENSE(MIT) / CONTRIBUTING.md / CODE_OF_CONDUCT.md
├── package.json                     # name: passtorch；bin: passtorch → 可 npx；type: module
├── tsup.config.ts                   # 编译 TS → 纯 JS 产物（node 可跑）
├── src/
│   ├── bin.ts          # 入口：裸调用→server；有子命令→惰性载 commander
│   ├── mcp/            # stdio MCP server（remember/recall[/list]）
│   │   ├── server.ts
│   │   └── tools.ts
│   ├── daemon/         # 共享大脑：HTTP + SSE + 托管观测页 + 自启/单例
│   │   ├── index.ts
│   │   ├── store.ts    # MemoryStore 接口 + JsonlStore（留向量位）
│   │   ├── lifecycle.ts# 端口发现 / lock / 单例 / 探活 / 自动拉起（§2）
│   │   └── project.ts  # git-root 项目识别（§3）
│   ├── web/            # 只读观测页（静态 HTML，零框架）
│   ├── cli/            # commander 子命令（daemon/dashboard/status/stop/service）
│   └── config.ts       # 数据目录 / 端口 / 别名 / telemetry:false
├── connect/            # Claude Code / Codex / Cursor 接入样例
├── test/               # 往返 / 生命周期竞态 / adapter 转发
└── .github/workflows/  # CI（lint+typecheck+test+build 矩阵）+ npm publish
```

---

## 8. 观测页硬化

保留原型三块（记忆库 / 调用流 / 连接状态）+ SSE 实时，零框架静态 HTML。v1 追加：
- 顶部「**数据 100% 本地 · 零遥测**」信任横幅（卖点显性化）。
- 空态引导（还没记忆时提示怎么接第一个 Agent）。
- 自检：再次确认**无任何新建 / 编辑 / 删除入口**（对齐 SPEC-057 V4 红线）。

---

## 9. 跨平台注意点（Windows 是主要风险）

| 点 | 处理 |
| --- | --- |
| detached spawn | Windows `detached:true` + `windowsHide:true`；mac/linux `unref()` |
| 路径 / 目录 | 走 `env-paths`，禁硬编码 `~` |
| git 探测 | `git` 不在 PATH 时降级到目录名，不崩 |
| 端口 / 回环 | 统一 `127.0.0.1`，不用 `localhost`（避免 IPv6 解析歧义） |

---

## 10. 测试策略（对齐 v1 DoD，不追 80%）

| 层 | 必测 |
| --- | --- |
| store | remember→recall 四字段往返一致；串行 append 无错乱 |
| lifecycle | 冷启动拉起；并发 5 server 只起 1 daemon；陈旧锁清理重起（§2.10 全表） |
| project | git-root 推导 / 无 git 兜底 / alias 命中 |
| adapter | 一次 MCP tool 调用正确转成 daemon HTTP（stub daemon） |
| e2e smoke | spawn server → remember → 另一 server recall 取回（跨「厂商」用 `--agent` 模拟） |

---

## 11. CI / 发布流水线

- CI（GitHub Actions）：`lint → typecheck → test → build`，矩阵 mac/linux/win × Node 18/20/22。
- 发布：tag → 自动 `npm publish`（带 provenance）+ GitHub Release。
- 语义化版本从 `0.1.0` 起。
- 提交 MCP registry / awesome-mcp-servers / Cursor·Claude MCP 目录。

---

## 附：命名决策（已定案 `passtorch`）

**定案（2026-07-16）：项目名 = `passtorch`。**

- **构词**：pass + torch = 「传递火炬」。火炬接力的意象**直扣核心叙事**——换一个 Agent，把项目上下文这支「火炬」原封不动传下去、不失忆、不重复踩坑。
- **归类**：属下方「**交接向**」——直击「换 Agent 无缝接手」的独特价值，与 mem0 那类「通用 fact 记忆」区隔最开。
- **中立性**：不含 360 / AgentDrive / eyun 任何字样，满足 spec §1 「中立性只能由无品牌载体承载」的前提。
- **占用核查**：npm 包名 / GitHub repo 以 `passtorch` 为准，终态占用核查见 [`tasks.md`](./tasks.md) §N（评审后、P0 前执行；若被占，退 `passtorch-mcp` / `agent-passtorch` 等前缀变体，不改火炬叙事）。

**曾评估的候选（决策留痕）：**

- **交接向**（最终采纳方向）：`handoff` / `baton`（接力棒）/ `relay` / **`passtorch`（采纳）**。
- **记忆 / 账本向**（未采纳）：`mnemo` / `agentmem` / `memkeep` / `agent-ledger` / `sidebrain`——偏「存储/记忆」语义，与 mem0 赛道正面撞车，区隔度不如交接向。
