# CCAgent 管理员开通指南

## 1. 目标

为 CCAgent Codex 插件开通 **Codex App 使用权限**。开通后，试点用户可以在 Codex App 中显式触发本地文件 review，并将 approved roots 内的指定文件发送给已批准 provider，例如 GLM 和 DeepSeek。

这不是绕过 tenant policy。Codex App 的 plugin/action 权限由 workspace app controls 管理，因此管理员需要在 workspace policy / Apps / Connectors / Manage actions 中正式批准 CCAgent plugin、MCP tools、外部 provider 和本地目录范围。

注意：当前 workspace app controls 是跨 surfaces 生效的控制面。也就是说，管理员是在 workspace 管理界面开通 CCAgent app/plugin，但目标使用入口是 Codex App；不要把本文理解为要求用户在 ChatGPT Web 中使用 CCAgent。

参考详细审核材料：[ccagent-tenant-policy-request.md](./ccagent-tenant-policy-request.md)。

## 2. Codex App 权限开通步骤

优先路径：

1. 用 workspace owner 或 admin 账号打开 ChatGPT。
2. 进入 `Workspace settings`。这是 Codex App plugin 权限的管理入口，不是要求在 ChatGPT Web 中执行 review。
3. 打开 `Apps`，或在当前界面中进入 `Connectors` / `Manage actions`。
4. 添加或启用 CCAgent custom MCP app：
   - Plugin source: `D:/CCAgent/plugins/ccagent`
   - Marketplace: `D:/CCAgent/.agents/plugins/marketplace.json`
   - MCP server: `ccagent`
   - Local daemon: `http://127.0.0.1:47621`
   - MCP entrypoint: `./apps/mcp-server/dist/apps/mcp-server/src/index.js`
5. 将访问范围限制为试点用户或试点用户组，不要 workspace-wide 默认启用。
6. 在 `Manage actions` / `Action control` 中选择 `Custom`。
7. 只允许下方“允许的 actions”列表中的 CCAgent tools。
8. 对未来新增 action 选择默认禁用。
9. 保存并发布配置。
10. 在试点用户机器上重启 Codex App 或新建 Codex App 会话，确认插件和 skill 已加载。

如果当前 workspace 没有 Apps / Connectors / Manage actions / custom MCP 发布入口，则向内部 tenant policy 管理员或 OpenAI workspace 支持渠道提交同等策略工单，使用本文第 3 节和第 4 节作为工单内容。

## 3. 需要允许的策略

允许的 app / MCP：

```text
App/plugin: ccagent
Marketplace: D:/CCAgent/.agents/plugins/marketplace.json
Plugin source: D:/CCAgent/plugins/ccagent
MCP server: ccagent
Daemon URL: http://127.0.0.1:47621
```

允许的 actions：

```text
ccagent.list_providers
ccagent.test_provider
ccagent.review_file
ccagent.review_file_multi
ccagent.get_review_batch_status
ccagent.read_review_batch_output
ccagent.get_task_status
ccagent.read_task_output
ccagent.cancel_task
```

允许的数据外发例外：

```text
允许试点用户通过 ccagent.review_file / ccagent.review_file_multi，
将 approved roots 内由用户显式指定的文件内容，
发送到已批准 provider endpoint 进行 review。
```

批准的 provider：

```text
glm / glm-5.1 / GLM_BASE_URL 指向的 GLM 或 Volcengine 兼容 endpoint
deepseek / deepseek-v4-flash / DEEPSEEK_BASE_URL 指向的 DeepSeek 兼容 endpoint
```

批准的本地目录由每台设备的 `ccagent.local-config.md` 声明：

```dotenv
CCAGENT_ALLOWED_ROOTS=D:/CodeAnalyze;D:/ProjectA;D:/ProjectB
CCAGENT_EXTERNAL_PROVIDER_CONSENT=glm:D:/CodeAnalyze;deepseek:D:/CodeAnalyze;glm:D:/ProjectA;deepseek:D:/ProjectA
```

## 4. 必须继续禁止的行为

即使开通 CCAgent，也应继续禁止：

- workspace-wide 默认启用，除非试点通过并完成复审。
- 发送 `D:/`、用户主目录、系统目录、云同步根目录等宽泛目录。
- 发送未在 `CCAGENT_ALLOWED_ROOTS` 中声明的文件。
- 发送未在 `CCAGENT_EXTERNAL_PROVIDER_CONSENT` 中声明的 provider/root 组合。
- 自动扫描目录并外发。
- hook、watcher、startup flow 或本地队列文件自动外发。
- 使用未审核 provider endpoint。
- 发送 secret、API key、token、credential 文件。
- 将 provider API key、daemon token 或 proxy token 写入 Codex config、plugin manifest、git 或聊天记录。

## 5. 设备配置和验收

每台试点设备执行：

```powershell
cd D:\CCAgent
pnpm.cmd install
pnpm.cmd build
pnpm.cmd dev:daemon
```

配置本机 `D:/CCAgent/ccagent.local-config.md`，写入 provider key、endpoint override、allowed roots 和 external provider consent。不要提交该文件中的真实密钥。

开通后新建 Codex App 会话，执行验收：

```text
检查 CCAgent providers，然后使用 CCAgent 对 D:/CodeAnalyze/example.md 做 GLM 和 DeepSeek 多 provider review。
```

通过标准：

- provider list 包含已批准 provider。
- `ccagent.review_file_multi` 能启动 daemon 持久化 batch。
- `ccagent.get_review_batch_status` 能返回 batch 状态。
- `ccagent.read_review_batch_output` 能返回分 provider 的 review 结果。
- 文件位于 approved roots 且请求由用户显式发起时，tenant policy 不再拒绝。
- 不在 approved roots、未批准 provider、自动外发、secret 文件仍会被拒绝。

## 6. 审批记录和回滚

审批记录：

| 字段 | 内容 |
|---|---|
| 审批人 | |
| 审批日期 | |
| 试点用户或用户组 | |
| 批准插件 | `ccagent` |
| 批准 marketplace | `D:/CCAgent/.agents/plugins/marketplace.json` |
| 批准 provider | |
| 批准本地目录 | |
| 下次复审日期 | |
| 备注 | |

回滚方式：

1. 在 workspace policy 中禁用插件 `ccagent`。
2. 移除或禁用 CCAgent marketplace entry。
3. 停止试点设备上的 CCAgent daemon。
4. 从 `ccagent.local-config.md` 中移除 provider consent 和 allowed roots。
