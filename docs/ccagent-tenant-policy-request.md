# CCAgent Tenant Policy Request

## Purpose

Request workspace approval for the CCAgent Codex plugin and MCP server so authorized users can review local project files with multiple configured external providers through an audited local daemon workflow.

## Requested Approval

Approve the repository-bundled CCAgent plugin at:

```text
D:/CCAgent/plugins/ccagent
```

The plugin exposes one local MCP server:

```text
name: ccagent
daemon URL: http://127.0.0.1:47621
repository MCP entrypoint: ./apps/mcp-server/dist/apps/mcp-server/src/index.js
```

The plugin should be allowed for designated users or groups that need local code/document review workflows. Do not enable it workspace-wide until the pilot group has completed validation.

## Tools Requested

Allow these MCP tools:

| Tool | Purpose | External data transfer |
|---|---|---|
| `ccagent.list_providers` | Lists locally configured providers. | No file content transfer. |
| `ccagent.test_provider` | Verifies provider configuration. | No workspace file content transfer. |
| `ccagent.review_file` | Reviews one local file with one provider. | Sends the selected file content to the selected provider via Claude Code CLI. |
| `ccagent.review_file_multi` | Reviews one local file with multiple providers. | Sends the selected file content to each selected provider. |
| `ccagent.get_review_batch_status` | Polls daemon-persisted batch status. | No file content transfer. |
| `ccagent.read_review_batch_output` | Reads persisted provider review results. | No new external transfer. |
| `ccagent.get_task_status` | Polls a daemon task. | No file content transfer. |
| `ccagent.read_task_output` | Reads a daemon task result. | No new external transfer. |
| `ccagent.cancel_task` | Cancels a daemon task. | No file content transfer. |

## Provider Allowlist

Approve only the provider endpoints configured by local operator policy. Current intended providers:

| Provider | Default model | Endpoint owner | Notes |
|---|---|---|---|
| `glm` | `glm-5.1` | GLM or configured Volcano/GLM-compatible endpoint | Base URL may be overridden locally by `GLM_BASE_URL`. |
| `deepseek` | `deepseek-v4-flash` | DeepSeek or compatible endpoint | Base URL may be overridden locally by `DEEPSEEK_BASE_URL`. |

Provider API keys must remain in the local secret store. They must not be stored in Codex plugin manifests, MCP config, git, or chat history.

## Workspace Root Scope

Approve file transfer only for explicit local roots declared in each machine's `ccagent.local-config.md`:

```dotenv
CCAGENT_ALLOWED_ROOTS=D:/CodeAnalyze;D:/ProjectA;D:/ProjectB
CCAGENT_EXTERNAL_PROVIDER_CONSENT=glm:D:/CodeAnalyze;deepseek:D:/CodeAnalyze;glm:D:/ProjectA;deepseek:D:/ProjectA
```

The approved roots should be project-specific. Avoid broad roots such as `D:/`, user profile directories, cloud-sync directories, and system directories.

## Required User Interaction

CCAgent review must remain explicitly user initiated. The plugin and daemon must not automatically send files to providers from hooks, background watchers, startup flows, or implicit queue files.

Acceptable invocation examples:

```text
Use CCAgent to review D:/CodeAnalyze/example.md with GLM and DeepSeek.
```

```text
Run CCAgent multi-provider review for this file and summarize provider disagreements.
```

## Audit Expectations

The daemon should retain or expose enough evidence to answer:

- who requested the review,
- when it was requested,
- selected file path,
- `cwd`,
- selected provider and model,
- batch id and task ids,
- status and error state,
- configured allowed root and consent match,
- whether the output was read back into Codex.

Audit reports must redact provider API keys, local bearer tokens, proxy tokens, and provider secrets.

## Boundaries

This approval should not allow:

- arbitrary internet access from Codex,
- sending files outside configured roots,
- sending secrets or credentials,
- automatic external transfer without a user review request,
- bypassing Codex host or tenant safety checks,
- adding unreviewed provider endpoints,
- using broad filesystem roots as implicit consent.

## Cross-Device Rollout

For each device:

1. Clone or update the `D:/CCAgent` repository.
2. Run `pnpm install` and `pnpm build`.
3. Create a local `ccagent.local-config.md` with provider keys, endpoint overrides, allowed roots, and provider consent.
4. Start the local daemon with `pnpm.cmd dev:daemon`.
5. Install or enable the repo plugin from `D:/CCAgent/.agents/plugins/marketplace.json`.
6. Open a new Codex session so plugin skills and MCP tools are loaded.

Local secrets and local paths are machine-specific and must not be committed.

## Admin Decision Checklist

- [ ] Pilot users or group identified.
- [ ] Approved provider endpoints documented.
- [ ] Approved local roots documented.
- [ ] External-provider consent format reviewed.
- [ ] Plugin source reviewed at `D:/CCAgent/plugins/ccagent`.
- [ ] MCP tool list reviewed.
- [ ] CCAgent daemon audit output reviewed.
- [ ] Rollback path documented: disable plugin access and stop local daemon.
