# CCAgent 小组角色 Review 设计

## 目标

CCAgent 已经支持针对单个文档的多 provider、多轮 review/edit 流程。下一步增加独立的 `Review Role` 层，让一次 review 不只是“哪些 provider 参与”，还包括“这些 provider 以哪些小组成员身份参与”。

本设计的目标是：

- 用户可以维护可复用的全局角色库。
- 用户可以让 Codex CLI 基于当前目标文档和 workspace 周边上下文生成临时角色库。
- 用户可以从全局角色库和临时角色库中选择一个或多个角色参与本次 review。
- 同一个 provider 一次调用中模拟多个角色组成的小组，而不是为每个角色单独启动一个 Claude Code task。
- Codex 汇总阶段能看到 provider + role 维度的 review 意见，并继续负责采纳、拒绝、延后和修改目标文档。

## 非目标

第一版不实现以下内容：

- 不维护项目级角色库。
- 不支持“每个角色单独启动一个 provider task”的执行模式。
- 不在角色定义中包含 `suggestedProviderIds`。
- 不做角色效果评分、自动优化或角色市场。
- 不做复杂的角色矩阵可视化；Status 继续以多轮决策摘要为主。

## 核心概念

### Provider

Provider 仍然表示执行能力和 API 配置，例如 `glm`、`deepseek`，包括 base URL、认证方式、默认模型和 review 模型。

### Review Role

Role 表示小组成员身份和审查职责，不绑定具体 provider。

建议字段：

```ts
interface ReviewRole {
  id: string;
  name: string;
  description: string;
  prompt: string;
  focusAreas: string[];
  outputInstructions: string;
  defaultSelected: boolean;
  source: "global" | "generated";
  createdAt: string;
  updatedAt: string;
}
```

字段含义：

- `id`: 稳定标识，用于存储和 run 输入。
- `name`: GUI 展示名称。
- `description`: 说明这个角色为什么存在。
- `prompt`: 该角色的身份、职责和审查边界。
- `focusAreas`: 结构化关注点，方便 GUI 展示和 prompt 组装。
- `outputInstructions`: 针对该角色输出格式的补充要求。
- `defaultSelected`: 是否默认勾选。
- `source`: 区分全局角色和本次生成的临时角色。

### Reviewer

运行时 reviewer 从现在的：

```ts
{
  provider: string;
  model?: string;
}
```

扩展为：

```ts
{
  provider: string;
  model?: string;
  roleIds: string[];
}
```

也就是说，一个 provider 可以在一次调用中携带多个角色，形成该 provider 内部的小组。

## 内置全局角色

第一版内置 5 个全局角色：

1. `文档结构审查员`，默认勾选
   - 检查章节结构、重复内容、叙述顺序、读者路径和信息组织。

2. `事实一致性审查员`，默认勾选
   - 检查日期、路径、命名、状态、结论、里程碑和引用是否自洽。

3. `可执行性审查员`，默认勾选
   - 检查任务拆解、命令、验收标准、后续动作、交接说明是否可执行。

4. `风险/反方审查员`，默认不勾选
   - 专门寻找隐含假设、遗漏风险、过度承诺、边界不清和反例。

5. `语言表达审查员`，默认不勾选
   - 检查措辞、可读性、简洁度、歧义、术语一致性和面向读者的表达质量。

## 角色库类型

### 全局角色库

全局角色库持久化在 daemon 存储中，由 GUI 管理。

功能：

- 查看角色列表。
- 新增角色。
- 编辑角色。
- 删除角色。
- 设置默认勾选状态。
- 从临时角色提升为全局角色。

全局角色库适合长期复用，例如常见文档审查职责、团队固定审查标准。

### 临时角色库

临时角色库由 Codex CLI 基于当前目标文档和 workspace 周边上下文生成。

生成规则：

- Codex 可以读取目标文档。
- Codex 可以扫描 workspace 周边上下文，用于理解项目、术语、实现状态和风险边界。
- Codex 只输出角色定义，不修改文档，不启动 review。
- 生成结果只进入当前 Review Workspace 页面中的临时角色区。
- 用户确认勾选后，临时角色才会参与本次 run。
- 用户可以把某些临时角色提升到全局角色库。

临时角色库适合当前文档特有的审查身份，例如算法一致性审查员、测试证据审查员、里程碑边界审查员。

## GUI 交互

### Review Roles 页面

新增 `Review Roles` 页面，用于管理全局角色库。

主要区域：

- 左侧角色列表。
- 右侧角色编辑器。
- `New role` 按钮。
- `Save` / `Delete` 操作。
- `Default selected` 开关。

角色编辑字段：

- Name
- Description
- Prompt
- Focus areas
- Output instructions
- Default selected

### Review Workspace 页面

Review Workspace 增加角色选择区域。

建议分区：

- `Global Roles`
  - 显示全局角色库。
  - 默认勾选 `defaultSelected = true` 的角色。

- `Generated Roles`
  - 显示本次由 Codex 生成的临时角色。
  - 支持勾选。
  - 支持将单个临时角色提升为全局角色。

- `Generate roles from document`
  - 调用 Codex CLI。
  - 输入为 workspace root、target file、language。
  - 生成临时角色库。

Provider 选择保持现有方式，但每个选中的 provider 会携带当前选中的角色集合。

## Prompt 组装

### Provider Review Prompt

对于每个 provider，CCAgent 只启动一次 Claude Code review task。

Prompt 中包含：

- provider id
- target file
- workspace root
- review style
- language
- role team

角色部分示例：

```text
Role team:

1. 文档结构审查员
Description: ...
Focus areas:
- ...
Role prompt:
...
Output instructions:
...

2. 事实一致性审查员
...
```

Provider 输出必须按角色分段：

```text
## Role: 文档结构审查员
...

## Role: 事实一致性审查员
...
```

如果某个角色没有发现问题，也需要明确说明没有可执行问题。

### Review Packet

Review packet 继续按 provider 分组，但每个 provider 内部保留 role 分段。

结构示例：

```text
## Provider: glm

### Role: 文档结构审查员
...

### Role: 事实一致性审查员
...
```

这让 Codex 汇总阶段可以同时看到 provider 维度和 role 维度。

### Codex Edit Prompt

Codex edit prompt 需要说明：

- Provider review findings are grouped by role.
- Codex should evaluate each role finding independently.
- Codex may accept, reject, or defer findings across roles.
- Codex should avoid mechanically applying suggestions just because multiple roles mention them.
- Codex final decision summary should retain which role or provider theme each decision came from when useful.

机器可解析的 `Continue Decision` 字段保持英文不变。

## 数据流

```text
用户选择 workspace + target file
  -> 可选：Codex 生成临时角色库
  -> 用户从全局角色和临时角色中勾选角色
  -> 用户勾选 provider
  -> CCAgent 为每个 provider 构造 role team prompt
  -> 每个 provider 一次调用内模拟多个角色并输出分段 review
  -> CCAgent 生成 review packet
  -> Codex 按 provider + role 维度审核意见
  -> Codex 修改目标文档
  -> Codex 输出每轮决策摘要
  -> Status 窗口按轮次展示采纳、拒绝、延后和用户总结
```

## 存储设计

### Global Role Store

建议新增 `review_roles` 存储。

SQLite 表或 JSON 存储均可，但应通过 storage package 封装。

字段：

- `id`
- `json`
- `created_at`
- `updated_at`

内存存储也要支持测试。

### Generated Roles

临时角色不需要全局持久化，但 run input 和 output 应记录当次使用的角色快照，保证审计可追溯。

建议在 run output 目录写入：

```text
roles.json
```

内容包括：

- selected global roles snapshot
- selected generated roles snapshot
- generated but not selected roles

这样后续打开 run 时能知道当时使用了哪些角色定义，而不是依赖当前全局角色库状态。

## API 设计

新增 daemon endpoints：

- `GET /review-roles`
- `POST /review-roles`
- `DELETE /review-roles/:id`
- `POST /review-roles/generate`
- `POST /review-roles/promote`

`POST /review-roles/generate` 输入：

```ts
{
  cwd: string;
  file: string;
  language?: string;
}
```

输出：

```ts
{
  roles: ReviewRole[];
}
```

`POST /review-roles/promote` 输入：

```ts
{
  role: ReviewRole;
}
```

输出保存后的全局角色。

Automation run request 扩展：

```ts
{
  reviewers: Array<{
    provider: string;
    model?: string;
    roleIds: string[];
  }>;
  roles: ReviewRole[];
}
```

`roles` 是本次 run 使用的角色快照，包含全局角色和临时角色。

## 错误处理

- 没有选择 provider：沿用现有校验。
- 没有选择角色：允许 fallback 到内置默认角色，或 GUI 阻止启动。第一版建议 GUI 阻止启动并提示用户至少选择一个角色。
- 角色生成失败：不影响手动选择全局角色 review。
- 临时角色提升失败：保留临时角色，不影响当前 run。
- provider 没有按角色分段输出：Codex 仍可读取原始 review，但 Status/审计应保留该 provider 输出格式不完整的事实。

## 测试计划

核心测试：

- 默认全局角色种子生成 5 个角色。
- 全局角色 CRUD。
- Codex 生成临时角色库并返回结构化角色。
- 临时角色可提升为全局角色。
- Automation run request 能携带 roles snapshot。
- Provider review prompt 正确包含选中角色。
- 同一 provider 只启动一次 task，即使携带多个角色。
- Review packet 保留 provider + role 分组。
- Codex edit prompt 明确 role 分组语义。
- GUI Review Workspace 能显示全局角色和临时角色，并按默认勾选状态初始化。

## 分阶段实现

### Phase 1: Core role model and storage

- 增加 `ReviewRole` 类型和 schema。
- 增加默认全局角色。
- 增加 role store。
- 增加 daemon CRUD endpoint。

### Phase 2: GUI global role management

- 新增 `Review Roles` 页面。
- 支持全局角色增删改和默认勾选。

### Phase 3: Generated roles

- 增加 `POST /review-roles/generate`。
- GUI 支持基于当前文档生成临时角色。
- 支持临时角色提升为全局角色。

### Phase 4: Role-aware automation run

- 扩展 automation run request。
- Review Workspace 提交 selected roles。
- Provider prompt 注入 role team。
- Review packet 保留 role 分组。
- Codex edit prompt 识别 role 分组。

### Phase 5: Verification and status polish

- 增补端到端测试。
- 确保 Status 每轮摘要能反映 provider + role 维度的采纳、拒绝、延后。
