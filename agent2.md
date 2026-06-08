
  ---
  1. 未解决：ErrorCodes 定义不完整

  Task 2 的 ErrorCodes 对象仍缺少多个在后续任务中引用的错误码：

  ┌───────────────────────────┬──────────────────────────────────────────────────────┐
  │         引用位置          │                     缺少的错误码                     │
  ├───────────────────────────┼──────────────────────────────────────────────────────┤
  │ Task 14 (concurrency)     │ CCAGENT_TASK_LIMIT                                   │
  ├───────────────────────────┼──────────────────────────────────────────────────────┤
  │ Task 11 (port exhaustion) │ CCAGENT_PROXY_PORT_UNAVAILABLE                       │
  ├───────────────────────────┼──────────────────────────────────────────────────────┤
  │ Task 14 (auth token)      │ CCAGENT_DAEMON_AUTH_UNAVAILABLE                      │
  ├───────────────────────────┼──────────────────────────────────────────────────────┤
  │ Task 13 (binary check)    │ CCAGENT_CLAUDE_NOT_FOUND, CCAGENT_CLAUDE_UNSUPPORTED │
  ├───────────────────────────┼──────────────────────────────────────────────────────┤
  │ Task 14 (recovery)        │ CCAGENT_DAEMON_RECOVERED                             │
  └───────────────────────────┴──────────────────────────────────────────────────────┘

  建议：在 Task 2 的 ErrorCodes 中补全这些条目，否则实现者会自行命名，导致不一致。

  ---
  2. 未解决：language 字段未接入 prompt template

  ReviewFileRequest 新增了 language 字段，但 Part A §10.1 和 Part B Task 4 的 prompt template 仍硬编码 "Return the
  result in Chinese"。buildReviewFilePrompt 应使用 request.language ?? "zh-CN"
  来动态生成语言指令。否则这个字段形同虚设。

  ---
  3. Part A 与 Part B 数据模型不同步

  - Part A §5.3 TaskResult.status 类型仍是 "ok" | "error" | "cancelled" | "timeout"，Part B Task 2 已使用
  TerminalTaskStatus 类型别名。建议 Part A 同步更新。
  - Part A §5.2 ReviewFileRequest 缺少 language 和 maxOutputBytes 字段。
  - Part A §5.1 缺少 DaemonSettings 接口定义。

  ---
  4. 新增 daemon-client 包未出现在 Master Task Tracker

  仓库布局和 Part B Task 14 都引入了 packages/daemon-client/，但 Master Task Tracker 18 行中没有对应条目。虽然 Task 14
  描述中提到了 "shared daemon client"，但 tracker 表格本身没有独立行。这不影响执行，但如果有人按 tracker
  检查进度会遗漏。

  建议：在 Task 14 的 Notes 列注明 "includes daemon-client package"，或增加第 19 行。

  ---
  5. /tasks/:id/output 与 /tasks/:id/logs 职责区分不明确

  Task 14 新增了 GET /tasks/:id/logs?maxBytes=...，同时保留了 GET /tasks/:id/output?maxBytes=...。两者区别未说明：
  - output 返回解析后的结构化结果？
  - logs 返回原始 stdout/stderr？

  建议：在 Task 14 中明确两者语义差异，避免实现者混淆。

  ---
  6. Auth Token 轮转的客户端同步问题

  Task 14 新增了 POST /auth/rotate-token，但未说明轮转后 MCP server 和 GUI 如何获取新 token。当前 MCP server 和 GUI 从
  config 读取 token，轮转后 config 中的值是否自动更新？如果 daemon 重启后用新 token，但 MCP server 仍用旧
  token，会导致认证失败。

  建议：明确轮转流程（例如：daemon 生成新 token → 写入 config → 返回新 token → 调用方更新本地引用）。

  ---
  7. 轻微问题

  ┌───────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┐
  │      项       │                                              说明                                               │
  ├───────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ /v1/models    │ Task 11 要求 "implement or document with an integration test that current Claude Code never     │
  │ 端点          │ calls it"。建议改为 "implement a stub returning the task model, and add a test" — 更明确。      │
  ├───────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ logsRef       │ TaskResult.logsRef 是必填字段，但如果 daemon 在存储日志前崩溃，无法生成有效 ref。建议标注为     │
  │ 必填性        │ "always set; use a best-effort fallback URL if log storage failed"。                            │
  ├───────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Part A §16    │ 已从 16 步更新为 18 步，与 Part B 对齐，很好。但第 14 步写 "Daemon API and shared daemon        │
  │ 实施顺序      │ client"，建议注明 daemon-client 是独立 package。                                                │
  └───────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────┘

  ---
  总结

  文档质量显著提升。剩余问题主要是：
  1. ErrorCodes 补全（阻塞实现一致性）
  2. language 字段接入 prompt（功能缺失）
  3. Part A 数据模型同步（文档准确性）

  这三个修复后可以直接进入实现阶段。