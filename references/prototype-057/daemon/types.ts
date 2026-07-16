/**
 * SPEC-057 原型：共享记忆层数据模型。
 * 企业地基四字段 who/when/intent/evidence 为必填——企业版审计/追责直接读这四字段。
 */

/** 一条记忆条目 */
export type MemoryEntry = {
  /** 稳定唯一 id */
  id: string;
  /** 项目标识（路径 hash 或用户指定 slug） */
  project: string;

  // ——— 企业地基四字段（必填，不得为空） ———
  /** 哪个 Agent + 会话，如 "claude-code" / "codex" */
  who: string;
  /** ISO8601 时间戳，由 daemon 自动填 */
  when: string;
  /** 当时想干什么（自然语言，由 Agent 传入） */
  intent: string;
  /** 改了什么 / 为什么放弃的可溯依据 */
  evidence: string;

  // ——— 演示辅助 ———
  /** 一句话摘要，供 recall 快速命中与页面展示 */
  summary: string;
  /** 可选，粗检索用 */
  tags?: string[];
};

/** 调用流日志项——观测页数据源 */
export type CallLogItem = {
  /** ISO8601 */
  ts: string;
  /** 发起调用的 Agent */
  agent: string;
  /** 操作类型 */
  op: 'remember' | 'recall';
  /** recall 命中 / remember 写入的条目 id（recall 可能命中多条，取首条或留空） */
  hitId?: string;
  /** recall 的 query 或 remember 的 intent */
  queryOrIntent: string;
};

/** remember 请求体（who 由适配器传入，when/id 由 daemon 生成） */
export type RememberInput = {
  project: string;
  who: string;
  intent: string;
  evidence: string;
  summary?: string;
  tags?: string[];
};
