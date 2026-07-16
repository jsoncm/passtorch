# SPEC-057 真实场景验收测试（手动触发）

> 这份文档解决一个问题：**让评审看到"真实的 Claude Code 和真实的 Codex"用起来什么样**，
> 而不是脚本模拟。每个 case 都带：痛点 → 操作（可直接粘贴的 prompt）→ 看板 → 通过判据 → 评审话术。
>
> 与 `verify-m3.ts` 的区别：
> - `verify-m3.ts` = **脚本**扮演两个 Agent，只证明"协议链路能跑通"（架构层）。
> - 本文档 = **真实模型**在对话里自己决定调 `remember`/`recall`（产品层）。评审看这个。

仓库绝对路径（本文已按你的机器填好，可直接复制）：

```
/Users/qihoo/per-wspace/ecs_agentdrive_client
```

---

## 0. 演示前准备（每次开演都做）

```bash
cd /Users/qihoo/per-wspace/ecs_agentdrive_client/prototypes/057-cross-agent-memory

# ① 清掉历史/smoke 残留，保证看板干净（否则会看到 smoke-agent 的垃圾卡片）
rm -f data/memory.jsonl data/calls.jsonl

# ② 起共享大脑 daemon（保持这个终端开着）
../../node_modules/.bin/tsx daemon/index.ts
# 输出 "共享大脑已启动 http://127.0.0.1:9057" 即成功；端口写入 data/.port

# ③ 浏览器打开观测台（新终端）
open http://127.0.0.1:9057/
```

> **看板读法速查**（对应你之前的疑问）：
> - **左栏「调用流」**：每一行是一次工具调用 = `谁 + remember/recall · 意图或查询词 · 时间 · 命中的记忆id`。这是"哪个 Agent 在什么时候动了记忆"的实时流水。
> - **右栏「共享记忆库」**：每张卡是一条记忆，含 `who/when/intent/evidence/project` 五字段。黄框高亮 = 刚被 recall 命中的那条。
> - **顶栏两个厂商灯**（Claude Code / Codex）：某厂商发起过调用就点亮，直观展示"两家都连着同一个大脑"。

---

## 1. 接线（真实 CLI 一次性配置）

### Claude Code — 在演示目标项目根目录放 `.mcp.json`

```json
{
  "mcpServers": {
    "cross-agent-memory": {
      "command": "/Users/qihoo/per-wspace/ecs_agentdrive_client/node_modules/.bin/tsx",
      "args": [
        "/Users/qihoo/per-wspace/ecs_agentdrive_client/prototypes/057-cross-agent-memory/mcp-adapter/index.ts",
        "--agent=claude-code"
      ]
    }
  }
}
```

进入该项目启动 `claude`，用 `/mcp` 确认 `cross-agent-memory` 已连接、能看到 `remember` / `recall` 两个工具。

### Codex — 在 `~/.codex/config.toml` 追加

```toml
[mcp_servers.cross-agent-memory]
command = "/Users/qihoo/per-wspace/ecs_agentdrive_client/node_modules/.bin/tsx"
args = [
  "/Users/qihoo/per-wspace/ecs_agentdrive_client/prototypes/057-cross-agent-memory/mcp-adapter/index.ts",
  "--agent=codex",
]
```

> 两个适配器唯一的差别是 `--agent=` 身份，且都读同一个 `data/.port` → 连的是**同一个 daemon**。这就是跨厂商共享的物理根据。

> **没装 Codex 怎么办**：见文末「附录 A：降级替身」。能演真跨厂商就演真的，这是最有说服力的一幕。

---

## 2. ★Case B（先讲这个，是全场王牌）：换厂商不再重蹈覆辙

> 其它 case 是热身/佐证，**这个 case 是价值本身**。建议评审时第一个演它。

**痛点**：你昨天用 Claude Code 试过某方案、踩了坑、放弃了。今天换 Codex（或反过来）接着干，它对昨天的坑一无所知，很可能**建议你把踩过的坑再踩一遍**。Claude 的记忆 OpenAI 读不到，反之亦然——这是单厂商记忆结构上的死角。

**操作**：

1. **真实 Claude Code**（项目 `demo-auth`）里粘贴：

   > 我在 demo-auth 这个项目要加接口限流。我刚试了「进程内 token bucket」方案，发现多进程部署下每个进程各算各的，限流形同虚设，已经放弃，打算改用 Redis 集中计数。把这个决定和原因记到跨 Agent 记忆里，project 用 `demo-auth`。

   Claude Code 应调用 `remember(project=demo-auth, intent=选限流方案, evidence=进程内token bucket多进程失效已放弃，改用Redis)`。

2. **完全关闭 Claude Code**（模拟"换人/换 Agent"）。

3. **真实 Codex**（同样 project）里粘贴——注意：**不要**告诉它之前的结论：

   > 我要给 demo-auth 加接口限流。动手前先回忆一下这个项目在限流上之前有没有踩过坑、有没有定过方案。project 用 `demo-auth`。

   Codex 应调用 `recall(project=demo-auth, query=限流)`，取回 Claude Code 写的那条，然后**主动说出**"之前进程内 token bucket 多进程失效放弃了，建议直接上 Redis"。

**看板**：左栏依次出现 `claude-code remember` → `codex recall`，两行命中**同一个 id**；顶栏两个厂商灯全亮。

**通过判据**：
- [ ] Codex 在你没提示的情况下，说出了"token bucket 多进程失效 / 已放弃 / 改 Redis"这层信息。
- [ ] Codex 没有反过来建议你用进程内 token bucket（没重踩坑）。
- [ ] 看板显示 `who=claude-code` 的记忆被 `codex` 取回。

**评审话术**：
> "换了个**另一家厂商**的 Agent，它没有让我重踩昨天的坑。这一幕，Claude Projects 给不了 ChatGPT，ChatGPT Memory 也给不了 Claude——**因为记忆被锁在各家账号里，而我们把它放在了用户本地的中立池子里。**"

---

## 3. Case A（热身）：真实 Agent 确实在驱动，不是脚本

**痛点**：证明这套东西不是"我们写死的演示"，而是真实模型自己在判断该不该调工具。

**操作**：真实 Claude Code 里粘贴：

> 记一条项目记忆：project 用 `demo-auth`，intent 是「确定鉴权方案」，evidence 是「团队决定用 JWT + 短过期 + refresh token，放弃 session 因为要多端」。

然后同一会话里换个说法问：

> 这个项目 demo-auth 的鉴权最后是怎么定的？帮我回忆下。

**通过判据**：
- [ ] 第一句触发 `remember`，看板右栏立刻多出一张 `who=claude-code` 的卡（实时，无需刷新）。
- [ ] 第二句触发 `recall`，Claude Code 复述出 JWT/refresh/放弃 session 的结论。

**评审话术**：
> "发起调用的是真实模型自己的决策——它读了工具描述，判断这该记/该查。看板的实时跳动就是证据。"

---

## 4. Case C：这不是聊天记录，是可追责的证据层

**痛点**：企业要的不是"AI 大概记得"，而是"**谁**、**什么时候**、**出于什么意图**、**基于什么依据**做的决定"——能审计、能甩锅、能复盘。

**操作**：任意真实 Agent 里问：

> demo-auth 项目关于限流的决定，是谁、什么时候、为什么做的？

**通过判据**：
- [ ] 取回的记忆带齐 `who`（哪个厂商的 Agent 写的）、`when`（时间戳）、`intent`（当时想干嘛）、`evidence`（可溯依据）。
- [ ] 看板卡片上四字段肉眼可见、非空。

**评审话术**：
> "每条记忆都带 who/when/intent/evidence。这是**审计地基**——大厂的 memory 是个黑盒摘要，我们的是结构化、可溯源的决策记录。企业私有化部署时，这就是合规的起点。"

---

## 5. Case D：数据不出本机（本地优先 = 可私有化）

**痛点**：企业最怕"我的代码决策被上传到某家美国公司的云"。

**操作**：

```bash
cd /Users/qihoo/per-wspace/ecs_agentdrive_client/prototypes/057-cross-agent-memory

# ① 记忆就是本地一个纯文本文件，肉眼可查、可 grep、可自己备份
cat data/memory.jsonl

# ② 断网演示：关掉 Wi-Fi，再在 Agent 里 recall 一次 —— 照常命中
#    （daemon 只监听 127.0.0.1，整条链路不碰公网）
```

**通过判据**：
- [ ] `data/memory.jsonl` 是明文 JSONL，每行一条记忆，人可读。
- [ ] 断网状态下 recall 仍然成功。

**评审话术**：
> "记忆是本机一个明文文件，daemon 只听 127.0.0.1，断网照跑。**数据主权 100% 在用户手里**——这正是我们相对云端 AI 记忆的结构性优势，也是进企业的敲门砖。"

---

## 6. 一页纸评审结论模板

> 实测记录：2026-07-15，真实 Claude Code + 真实 Codex 二进制。详见 `VERIFICATION.md` V1-真机。

| Case | 验证的价值主张 | 结果 |
| --- | --- | --- |
| B ★ | 跨厂商中立：换 Agent 不重踩坑（大厂结构上做不到） | ✅ 通过（2026-07-15 真机实测，Codex 明确"不重踩 token bucket，直接上 Redis"） |
| A | 真实模型在驱动，非脚本演示 | ✅ 通过（Case B 中 Codex 自主生成检索词、首查未命中后改写再命中，证真实决策） |
| C | 结构化证据层：who/when/intent/evidence 可审计 | ✅ 通过（Case B recall 取回记忆含完整四字段，`who=claude-code` 可溯源） |
| D | 本地优先：数据不出本机、可私有化 | ☐ 未单独实测（架构上 daemon 仅监听 127.0.0.1、记忆明文落 `data/*.jsonl`，见 VERIFICATION V2；断网复演待补） |

> B 通过 = 核心假设在**真实产品层**成立，不只是架构层。这是"是否进主项目"的决策依据。
> A、C 由 Case B 的 Codex 执行原文顺带实证（同一次真机会话覆盖）；D 仅剩"断网复演"这一步未现场跑，架构层已由 V2 保证。

---

## 附录 A：没装 Codex 时的降级替身（诚实标注为较弱证据）

真跨厂商（真 Claude Code + 真 Codex）说服力最强。若现场只有 Claude Code：

- **替身一（次强）**：再开一个真实 Claude Code 实例，`.mcp.json` 里把身份改成 `--agent=codex`。仍是真实模型在驱动、仍是两个独立进程共享同一大脑，**只是两个 Agent 都来自 Anthropic**——证明了"不同身份共享同一记忆池"，但没证到"跨公司"。演示时要如实说明这一点。
- **替身二（最弱，仅验链路）**：直接 `../../node_modules/.bin/tsx verify-m3.ts` 跑脚本闭环——这就是 `VERIFICATION.md` 的 V1，只证架构层，**不要**用它冒充真实产品演示。

> 评审前若能装上真实 Codex，务必用第 2 节的真跨厂商流程——Case B 的冲击力全在"另一家厂商"这四个字上。
