# CCAgent GUI 端到端自动化设计

日期：2026-06-08

## 目标

把 CCAgent 做成带 GUI 的 review 流程宿主。用户在 GUI 中配置 Claude Code provider、Claude review 提示词模板、Codex edit 提示词模板和目标文件后，点击 Start 即可自动完成：

1. 多 provider Claude Code review。
2. review 结果汇总和本地 packet 持久化。
3. 调用 Codex CLI 根据 review packet 修改目标文档。
4. 在 GUI 中展示进度、输出、diff、日志和最终报告。

默认模式是完全自动，不在 Codex 修改前强制人工确认。失败时保留中间产物，并提供重试入口。

## 非目标

- 不通过 Codex MCP 绕过 Codex App 或 tenant policy 的外发限制。
- 不把 GUI 做成 marketplace 插件依赖项；GUI 是 CCAgent 自己的主控台。
- 第一版不实现复杂协作审批、云同步和多人权限系统。
- 第一版不要求 Codex App 主动管理流程，Codex CLI 只作为 CCAgent 启动的本地执行器。

## 产品页面

### Review Workspace

Review Workspace 是默认首页，用于创建一次端到端 run。

核心控件：

- 目标文件路径选择。
- workspace root 选择或自动识别。
- provider 多选，例如 GLM、DeepSeek、Volcengine。
- Claude review 模板选择。
- Codex edit 模板选择。
- review style、language、timeout、并发数等运行参数。
- Start、Cancel、Retry failed、Open output directory。

点击 Start 后，GUI 创建 run，daemon 接管后续状态流转。

### Providers

Providers 用于配置 Claude Code 调用外部 provider 所需信息。

每个 provider 至少包含：

- provider id 和显示名称。
- 启用状态。
- Claude Code CLI 路径或调用 profile。
- API endpoint、model、环境变量名或本地 secret 引用。
- 默认超时、最大输出字节数、并发限制。
- Test 按钮，用于验证 CLI、鉴权和模型可用性。

密钥不直接展示在 GUI 明文中。现有 secret 存储能力继续复用。

### Prompt Templates

Templates 分为两类。

Claude review 模板用于生成每个 provider 的 review prompt。支持变量：

- `{file}`
- `{workspaceRoot}`
- `{provider}`
- `{reviewStyle}`
- `{language}`
- `{targetDocument}`

Codex edit 模板用于生成 Codex CLI prompt。支持变量：

- `{targetDocument}`
- `{workspaceRoot}`
- `{reviewPacket}`
- `{reviewResults}`
- `{failedProviders}`
- `{runId}`

模板需要版本号、名称、用途说明、默认启用标记和预览功能。保存模板时做变量校验，避免缺少必要输入。

### Runs

Runs 展示历史和当前执行中的 run。

列表字段：

- run id。
- 目标文件。
- provider 数量。
- 当前阶段。
- 成功、失败、取消数量。
- 开始时间、结束时间、耗时。

详情页展示：

- 每个 provider 的状态、耗时、输出摘要、错误信息和完整输出入口。
- merged review packet。
- Codex CLI prompt、日志、退出码。
- Codex 修改后的 git diff 或文件 diff。
- 最终报告。
- Retry failed providers、rerun Codex edit、cancel run。

### Settings

Settings 管理本机运行环境。

配置项：

- daemon 地址和状态。
- 默认输出目录。
- workspace allowed roots。
- Claude Code CLI 默认路径。
- Codex CLI 路径。
- 默认自动化策略：第一版默认 `fullyAuto=true`。
- 输出保留策略。

## 状态机

一次 run 的主状态：

1. `queued`：run 已创建，等待 daemon 调度。
2. `reviewing`：daemon 并行启动 provider review task。
3. `merging`：所有可用 provider 结束后生成 merged review packet。
4. `codex_editing`：daemon 启动 Codex CLI，Codex 读取本地 packet 和目标文件并修改。
5. `verifying`：daemon 收集 Codex 结果，读取 diff，生成最终报告。
6. `done`：端到端流程成功完成。
7. `failed`：流程失败，但保留所有中间产物。
8. `cancelled`：用户取消。

provider 子任务状态：

- `queued`
- `running`
- `succeeded`
- `failed`
- `timeout`
- `cancelled`

默认合并策略：

- 如果至少一个 provider 成功，进入 `merging`。
- 失败 provider 的错误写入 packet，不阻塞后续 Codex edit。
- 如果所有 provider 都失败，run 进入 `failed`，不启动 Codex。

## 数据流

```text
GUI
  -> daemon: create run
  -> daemon: subscribe/poll run status

daemon
  -> provider tasks: launch Claude Code CLI per provider
  -> storage: persist provider outputs
  -> storage: write merged review packet
  -> codex task: launch Codex CLI with edit template
  -> storage: persist Codex logs, diff, final report

GUI
  -> daemon: read run detail, outputs, packet, diff
```

所有外部 provider review 由 CCAgent daemon 启动的 Claude Code CLI 进程执行，不经过 Codex MCP tool 传输目标文件内容。

Codex CLI 阶段只读取本地 review packet 和目标文件。它是否会把上下文发送给 Codex 使用的模型，取决于用户的 Codex CLI 配置和账号策略；这不是 CCAgent 规避的对象。

## 持久化模型

复用现有 task 和 review batch 存储，新增 run 聚合层。

建议实体：

- `automation_runs`
- `automation_run_providers`
- `prompt_templates`
- `codex_edit_tasks`

文件输出目录建议：

```text
.ccagent/runs/<runId>/
  input.json
  providers/<providerId>/output.md
  providers/<providerId>/error.txt
  review-packet.md
  codex-prompt.md
  codex-output.md
  diff.patch
  final-report.md
```

数据库保存索引、状态、元数据和文件路径。大输出继续落盘，避免 SQLite 记录膨胀。

## Daemon API

新增或扩展 HTTP API：

- `POST /automation-runs`
- `GET /automation-runs`
- `GET /automation-runs/:runId`
- `GET /automation-runs/:runId/output`
- `POST /automation-runs/:runId/cancel`
- `POST /automation-runs/:runId/retry`
- `POST /automation-runs/:runId/rerun-codex`
- `GET /prompt-templates`
- `POST /prompt-templates`
- `PUT /prompt-templates/:templateId`
- `DELETE /prompt-templates/:templateId`

GUI 通过 IPC 调用 daemon client，不直接访问存储层。

## GUI IPC

新增 IPC 能力：

- `createAutomationRun`
- `listAutomationRuns`
- `getAutomationRun`
- `readAutomationRunOutput`
- `cancelAutomationRun`
- `retryAutomationRun`
- `rerunCodexEdit`
- `listPromptTemplates`
- `savePromptTemplate`
- `deletePromptTemplate`

Renderer 只处理表单、状态展示和用户动作。进程调度、路径校验、模板渲染和安全边界都在 main/daemon 侧完成。

## 错误处理

关键错误与行为：

- daemon 不在线：GUI 显示 daemon unavailable，并提供重连或启动提示。
- provider 配置无效：run 创建前阻止启动，Test 失败给出 provider 级错误。
- provider 超时：标记 provider 为 `timeout`，保留部分输出，继续等待其他 provider。
- 所有 provider 失败：run 进入 `failed`，不启动 Codex。
- Codex CLI 缺失或失败：run 进入 `failed`，保留 review packet，并允许重跑 Codex。
- Codex 修改后无 diff：标记为 `done`，最终报告说明没有修改。
- 用户取消：停止未完成 provider task 和 Codex task，已完成输出保留。

## 安全和审计

GUI 启动 run 前必须显示目标文件、workspace root 和选中的 provider。默认完全自动不代表隐藏外发边界。

每次 run 的 `input.json` 记录：

- 目标文件。
- workspace root。
- provider 列表。
- Claude 模板 id 和版本。
- Codex 模板 id 和版本。
- 创建时间。
- 启动用户。
- 是否 fully auto。

`review-packet.md` 和 `final-report.md` 记录各 provider 的成功、失败、超时和输出路径。这样跨机器迁移时仍能审计“哪些文件通过哪些 provider review 过”。

## 测试计划

单元测试：

- 模板变量渲染和缺失变量校验。
- run 状态机转换。
- provider 成功、部分失败、全部失败、超时、取消。
- review packet 生成。

daemon/API 测试：

- 创建 run 后持久化。
- 轮询 run 状态。
- provider 输出落盘。
- Codex task 成功和失败路径。
- daemon 重启后恢复历史 run。

GUI 测试：

- Review Workspace 表单校验。
- provider 多选和模板选择。
- Runs 列表和详情状态展示。
- 失败 run 的 retry/rerun 操作。

验收测试：

- 使用两个 mock provider 跑完整端到端流程。
- 使用一个成功、一个失败 provider，确认仍会进入 Codex edit。
- 模拟所有 provider 失败，确认不会启动 Codex。
- 模拟 Codex CLI 失败，确认 review packet 可读且可重跑 Codex。

## 分阶段实现

虽然产品默认是端到端自动化，实施仍分阶段落地：

1. run 聚合模型和 daemon API。
2. prompt template 存储和渲染。
3. GUI Review Workspace、Templates、Runs 页面。
4. daemon 并行 provider review 接入 run。
5. Codex CLI edit task 接入 run。
6. final report、diff 展示和 retry/rerun。
7. 端到端 mock provider 验收。

每一阶段都保持可运行，不把所有能力压到最后一次集成。

## 自检

- 范围聚焦在 GUI 宿主端到端自动化，没有继续依赖 Codex MCP 外发 review。
- 默认策略明确为完全自动。
- provider review 和 Codex edit 的责任边界明确。
- 失败策略明确，尤其是部分 provider 失败和全部 provider 失败。
- 测试覆盖状态机、API、GUI 和端到端验收。
