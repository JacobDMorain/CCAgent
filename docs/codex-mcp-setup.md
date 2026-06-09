# CCAgent Codex MCP Setup

This guide explains how to start CCAgent locally, connect it to Codex as an MCP server, and run the first review task.

## Start the daemon

From the repository root:

```bash
pnpm dev:daemon
```

The daemon listens on `127.0.0.1:47621` by default and owns provider configuration, secrets, task history, proxy ports, and Claude runner orchestration.

## Run the GUI

From the repository root:

```bash
pnpm dev:gui
```

The GUI main process is the only GUI-side process allowed to start or own the daemon. The renderer talks through preload IPC only.

## Register the MCP server

Build the workspace first:

```bash
pnpm build
```

To register the MCP server for the current Windows user without writing daemon bearer tokens into Codex config:

```bash
pnpm codex:mcp:register
```

The command backs up the existing Codex config and adds a `ccagent` MCP block that points at the built MCP server entrypoint. It also sets `cwd` to the CCAgent workspace and passes `CCAGENT_LOCAL_CONFIG_PATH` so the daemon can sync provider templates, URL overrides, API keys, allowed workspace roots, and operator egress consent from `ccagent.local-config.md` at startup. The MCP server also attempts the same sync when Codex starts it. If the daemon is not running yet, the MCP server logs a warning and still completes the MCP handshake so Codex can show the tools; tool calls will report daemon connectivity errors until the daemon is started. The MCP server will read the daemon token from the local CCAgent secret store when it runs under the same Windows account as the daemon.

Alternatively, register the MCP command manually. Only include `CCAGENT_DAEMON_TOKEN` when Codex runs as a different user and cannot read the local CCAgent secret store:

```json
{
  "mcpServers": {
    "ccagent": {
      "command": "node",
      "args": ["D:/CCAgent/apps/mcp-server/dist/apps/mcp-server/src/index.js"],
      "cwd": "D:/CCAgent",
      "env": {
        "CCAGENT_LOCAL_CONFIG_PATH": "D:/CCAgent/ccagent.local-config.md",
        "CCAGENT_DAEMON_URL": "http://127.0.0.1:47621",
        "CCAGENT_DAEMON_TOKEN": "<daemon bearer token>"
      }
    }
  }
}
```

If Codex runs on the same Windows account as the daemon, `CCAGENT_DAEMON_TOKEN` may be omitted. In that case the MCP server reads `%APPDATA%/CCAgent/config.json` and the local secret store to obtain the daemon bearer token.

Do not put provider API keys directly in the MCP configuration. Keep operator-supplied provider keys in `ccagent.local-config.md`; the daemon syncs them into the local secret store.

To make workspace access and external-provider consent portable across machines, add non-secret policy entries to `ccagent.local-config.md`:

```dotenv
CCAGENT_ALLOWED_ROOTS=D:/CodeAnalyze;D:/AnotherProject
CCAGENT_EXTERNAL_PROVIDER_CONSENT=glm:D:/CodeAnalyze;deepseek:D:/AnotherProject
```

`CCAGENT_ALLOWED_ROOTS` is persisted into the daemon workspace policy when the local config is synced. `CCAGENT_EXTERNAL_PROVIDER_CONSENT` records operator intent that content under a root may be sent to the named external provider; it does not bypass Codex host safety checks.

After registration, run this from the repository root to record token-free acceptance evidence:

```bash
pnpm acceptance:codex-mcp
```

## Example `ccagent.review_file`

```json
{
  "provider": "glm",
  "model": "glm-5.1",
  "cwd": "D:/project",
  "file": "test.md",
  "reviewStyle": "full",
  "timeoutMs": 600000,
  "maxOutputBytes": 131072
}
```

For long provider calls in Codex App, prefer async mode so the MCP tool returns before the app-level tool timeout:

```json
{
  "provider": "glm",
  "model": "glm-5.1",
  "cwd": "D:/project",
  "file": "large.md",
  "reviewStyle": "full",
  "mode": "async",
  "timeoutMs": 600000,
  "maxOutputBytes": 131072
}
```

The async response includes a `taskId`. Poll it with `ccagent.get_task_status` until `status` is `ok`, `error`, `cancelled`, or `timeout`, then read the completed output with `ccagent.read_task_output`:

```json
{ "taskId": "task_..." }
```

```json
{ "taskId": "task_...", "maxBytes": 131072 }
```

## Example multi-provider review

Use `ccagent.review_file_multi` when you want several external providers to review the same file in parallel. The tool asks the daemon to start one async task per reviewer and returns a `batchId` plus child `taskId` values. Batch metadata is persisted in daemon storage, so a later MCP session or daemon restart can continue polling the same `batchId`.

```json
{
  "cwd": "D:/project",
  "file": "large.md",
  "reviewStyle": "full",
  "reviewers": [
    { "provider": "glm", "model": "glm-5.1" },
    { "provider": "deepseek", "model": "deepseek-v4-flash" }
  ],
  "timeoutMs": 600000,
  "maxOutputBytes": 131072
}
```

Poll the batch with `ccagent.get_review_batch_status`:

```json
{ "batchId": "batch_..." }
```

When all child tasks are terminal, read the combined result with `ccagent.read_review_batch_output`:

```json
{ "batchId": "batch_...", "maxBytes": 131072 }
```

The combined output keeps each provider result separate and includes a short status summary. A failed provider does not hide successful provider reviews.

## Example `ccagent.run_task`

```json
{
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "cwd": "D:/project",
  "prompt": "Review test.md and return concise findings.",
  "files": ["test.md"],
  "mode": "sync",
  "timeoutMs": 600000
}
```

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| daemon unavailable | The daemon is not running or the URL is wrong. | Start the daemon with `pnpm dev:daemon` and verify `GET /health`. |
| MCP tools load but calls fail | The MCP server completed startup while the daemon was offline. | Start the daemon, then retry the tool call. |
| Claude binary missing | `settings.claude.path` does not point to a runnable Claude Code binary. | Set the Claude path in settings or ensure `claude` is on `PATH`. |
| provider missing | The requested provider id is not saved or is disabled. | Add the provider in the GUI or daemon API and enable it. |
| API key missing | The provider exists but its `apiKeyRef` has no stored secret. | Fill `ccagent.local-config.md`, re-run `pnpm codex:mcp:register` if needed, then restart the daemon/Codex MCP server. |
| path denied | `cwd` or file arguments are outside configured workspace roots. | Add the project directory to workspace roots before running file-reading tools. |
| provider API error | The upstream provider rejected the request or returned an incompatible response. | Use provider test, check model name, base URL, auth header, and API quota. |
| empty workspace root configuration | First-run settings intentionally have no allowed roots. | Add explicit workspace roots in Settings before accepting review tasks. |
| max concurrent task limit reached | `tasks.maxConcurrentTasks` is already in use and overflow is `reject`. | Wait for a task to finish or raise the configured limit. |
| daemon recovered an orphaned running task | The daemon restarted while a task was pending or running. | Inspect task logs; recovered tasks are marked `error` with `CCAGENT_DAEMON_RECOVERED`. |
