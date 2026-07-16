# 接入 Claude Code

让 Claude Code 通过 MCP 连上跨 Agent 共享记忆层。

## 前置

先启动 daemon（共享大脑）：

```bash
cd prototypes/057-cross-agent-memory
bun run daemon        # 或 ../../node_modules/.bin/tsx daemon/index.ts
```

daemon 会监听 `127.0.0.1:9057`（占用则自动 +1），端口写入 `data/.port`。

## 方式一：项目级 `.mcp.json`（推荐，便于演示）

在你要演示的**目标项目根目录**放一个 `.mcp.json`：

```json
{
  "mcpServers": {
    "cross-agent-memory": {
      "command": "<绝对路径>/node_modules/.bin/tsx",
      "args": [
        "<绝对路径>/prototypes/057-cross-agent-memory/mcp-adapter/index.ts",
        "--agent=claude-code"
      ]
    }
  }
}
```

> 把 `<绝对路径>` 换成本仓库的实际绝对路径。`--agent=claude-code` 决定写入记忆的 `who` 字段。

## 方式二：`claude mcp add`

```bash
claude mcp add cross-agent-memory \
  -- <绝对路径>/node_modules/.bin/tsx \
     <绝对路径>/prototypes/057-cross-agent-memory/mcp-adapter/index.ts \
     --agent=claude-code
```

## 验证

在 Claude Code 里让它调用工具：

- `remember`：记一条「intent + evidence」
- `recall`：按关键词回忆

然后打开观测页 `http://127.0.0.1:<port>/`（M4 交付后）即可看到写入的记忆与调用流。

## 可用工具

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `remember` | project, intent, evidence, summary? | 记一条带意图与证据的项目记忆 |
| `recall` | project, query, limit? | 回忆该项目做过/试过/放弃过什么 |
