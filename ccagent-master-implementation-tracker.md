# CCAgent Master Implementation Tracker

This is the single tracking document for CCAgent. It combines the architecture, implementation plan, coding task breakdown, validation plan, and acceptance checklist into one file.

## Status Legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked

## Master Task Tracker

| # | Task | Status | Owner | Notes |
|---|---|---|---|---|
| 1 | Monorepo scaffolding | [x] | Codex | pnpm workspace scaffold, package configs, test/typecheck scripts |
| 2 | Core types, errors, schemas | [x] | Codex | Zod schemas and required error codes covered by tests |
| 3 | Path and workspace policy | [x] | Codex | Basic Windows path normalization and cwd/file containment tests |
| 4 | Prompt templates | [x] | Codex | Review/run templates with language fallback tests |
| 5 | Provider registry and model resolver | [x] | Codex | Built-in GLM/DeepSeek templates and in-memory registry tests |
| 6 | Secret store | [x] | Codex | SecretStore interface, memory test backend, encrypted local file backend, fingerprint/missing-key/persistence tests |
| 7 | SQLite storage | [x] | Codex | Real SQLite file persistence implemented with Node node:sqlite plus in-memory test backend; provider/settings/task/log reopen tests |
| 8 | Proxy fixtures and protocol types | [x] | Codex | JSON fixtures and protocol TS types |
| 9 | Anthropic/OpenAI proxy conversion | [x] | Codex | Basic request/response conversion with unsupported-block errors |
| 10 | Streaming adapter | [x] | Codex | OpenAI SSE to Anthropic SSE events and malformed JSON error tests |
| 11 | Per-task proxy server | [x] | Codex | Node HTTP proxy, auth, /v1/models, forwarding, port allocator tests |
| 12 | Claude output parser | [x] | Codex | JSON and stream-json parser tests |
| 13 | Claude runner | [x] | Codex | spawn runner, stdout/stderr capture, timeout cancellation tests |
| 14 | Daemon API, task manager, shared daemon client | [x] | Codex | Auth, provider CRUD/secret/test, settings roots, runner/proxy orchestration, active cancellation, output/logs, startup recovery; includes independent `packages/daemon-client` package |
| 15 | MCP server | [x] | Codex | SDK stdio server, seven registered tools, daemon-client forwarding, JSON content/structured response tests |
| 16 | GUI | [x] | Codex | Electron main/preload IPC, React provider/task/settings surfaces, renderer/static smoke tests; runtime E2E remains Task 17 |
| 17 | End-to-end tests | [x] | Codex | Fake Claude/OpenAI fixtures, MCP review_file E2E, concurrent proxy ports, cancel isolation, logs, recovery, missing Claude preflight |
| 18 | Documentation and packaging | [x] | Codex | Setup/provider/release docs, Windows package manifest script, docs/package tests, package:windows verified |

Part B is the canonical executable task list. Part A describes architecture and constraints only; do not track progress against a second task numbering scheme.

## Final Acceptance Checklist

- [ ] Start CCAgent daemon.
- [ ] Start CCAgent GUI.
- [ ] Configure GLM provider with API key and model `glm-5.1`.
- [ ] Register CCAgent MCP server in Codex.
- [ ] In Codex, call `ccagent.review_file` with GLM on `test.md`.
- [ ] Confirm Codex receives review text.
- [ ] Confirm GUI task dashboard shows the completed task.
- [ ] Confirm no global Claude Code settings file was modified.
- [ ] Start another task with DeepSeek while GLM task is running.
- [ ] Confirm both tasks finish independently.
- [ ] Confirm task cancellation kills only the selected task.
- [ ] Confirm task logs are readable after completion.
- [ ] Confirm API keys are not visible in MCP output, GUI output, or logs.
- [ ] Confirm path policy rejects files outside allowed roots.
- [ ] Confirm daemon startup recovery marks orphaned running tasks as errored.
- [ ] Confirm max concurrent task limit is enforced.
- [ ] Confirm proxy port exhaustion returns a structured error.
- [x] Confirm GLM and DeepSeek provider template URLs were verified before release.

## Validation Commands

```bash
pnpm typecheck
pnpm test
pnpm playwright test
pnpm build
```

---

# Part A: Architecture and Implementation Plan

# CCAgent First Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete first-version CCAgent that lets Codex call an MCP tool, select a provider/model such as GLM 5.1 or DeepSeek, run Claude Code against that provider, and return the task result back to Codex.

**Architecture:** CCAgent is a local desktop/service system with four cooperating surfaces: an MCP server for Codex, a local daemon for task/provider/proxy orchestration, a GUI for human configuration and monitoring, and a per-task Claude Code runner. Provider isolation is achieved by injecting environment variables into each Claude Code child process and allocating per-task local proxy ports when protocol conversion is needed.

**Tech Stack:** TypeScript/Node.js for MCP server, daemon, runner, proxy, and shared core; Electron for GUI; SQLite for local task/history storage; authenticated encrypted local secret storage for API keys; Vitest for unit tests; Playwright for GUI smoke tests.

---

## 1. Product Scope

The first version is a complete usable product, not a staged MVP. It must include:

- Codex-callable MCP server.
- GUI configuration for providers, API keys, models, defaults, and task history.
- Claude Code non-interactive execution through `claude -p`.
- Per-task provider/model selection.
- Anthropic-compatible direct routing.
- OpenAI-compatible provider routing through a local Anthropic-to-OpenAI proxy.
- Concurrent task isolation so provider A and provider B tasks do not affect each other.
- Structured task result return to Codex.
- Task cancellation, timeout, logs, and status inspection.
- Local secure API key storage.
- Workspace/file access validation.

Out of scope for the first version:

- Replacing Claude Code internals.
- Training or fine-tuning models.
- Remote multi-machine execution.
- Cloud-hosted task scheduling.
- Automatic provider price optimization.

---

## 2. User-Facing Behavior

### 2.1 Example Codex Request

User asks Codex:

```text
通过 CCAgent 使用 glm5.1 review 文档 test.md，并把 review 意见反馈到当前 Codex 窗口。
```

Codex calls MCP tool:

```json
{
  "tool": "ccagent.review_file",
  "arguments": {
    "provider": "glm",
    "model": "glm-5.1",
    "cwd": "D:/project",
    "file": "test.md",
    "reviewStyle": "full",
    "timeoutMs": 600000
  }
}
```

CCAgent returns:

```json
{
  "status": "ok",
  "taskId": "task_20260605_000001",
  "provider": "glm",
  "model": "glm-5.1",
  "cwd": "D:/project",
  "summary": "发现 4 个主要问题，集中在结构、事实一致性和措辞可验证性。",
  "content": "完整 review 意见...",
  "logsRef": "ccagent://tasks/task_20260605_000001/logs",
  "startedAt": "2026-06-05T10:00:00+08:00",
  "finishedAt": "2026-06-05T10:02:31+08:00",
  "durationMs": 151000
}
```

### 2.2 GUI Behavior

The GUI provides:

- Provider list: Anthropic-compatible, OpenAI-compatible, custom.
- Provider editor: id, display name, mode, base URL, auth header style, model aliases, capabilities.
- API key entry: saved securely, never displayed after save except masked.
- Test provider button: sends a small Claude Code/proxy-compatible probe.
- Task dashboard: active tasks, completed tasks, provider, model, cwd, status, duration, output preview.
- Task controls: cancel active task, open log, copy output.
- Settings: allowed workspace roots, default timeout, Claude binary path, proxy port range.

---

## 3. System Architecture

```text
Codex
  -> MCP stdio server: ccagent-mcp
    -> Local daemon API: ccagent-daemon
      -> TaskManager
      -> ProviderManager
      -> SecretStore
      -> ProxyManager
      -> ClaudeRunner
      -> TaskStore
        -> SQLite
      -> Local API proxy per task when needed
        -> Provider upstream API
```

### 3.1 Components

- `ccagent-mcp`: exposes tools to Codex through MCP stdio.
- `ccagent-daemon`: local service that owns task lifecycle, provider config, secrets, proxy allocation, and runner orchestration.
- `ccagent-gui`: Electron app that configures providers and observes tasks through daemon API.
- `ccagent-daemon-client`: shared typed HTTP client used by MCP and GUI to call the daemon.
- `ccagent-core`: shared types, validation, config loading, path checks, result schemas.
- `ccagent-runner`: starts Claude Code child processes with task-specific env.
- `ccagent-proxy`: local HTTP server that converts Anthropic Messages API to OpenAI-compatible chat completions.
- `ccagent-storage`: SQLite task/config storage and encrypted secret references.

### 3.2 Why Use a Daemon

MCP servers are best kept as narrow tool adapters. The daemon provides one stable owner for long-running state: active tasks, proxy ports, cancellation, task logs, GUI visibility, and provider health. This prevents GUI and MCP from duplicating execution logic.

---

## 4. Repository Layout

```text
ccagent/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  apps/
    gui/
      package.json
      src/
        main/
          index.ts
          preload.ts
        renderer/
          App.tsx
          routes/ProvidersPage.tsx
          routes/TasksPage.tsx
          components/ProviderForm.tsx
          components/TaskTable.tsx
      tests/gui-smoke.spec.ts
    mcp-server/
      package.json
      src/index.ts
      src/tools/listProviders.ts
      src/tools/testProvider.ts
      src/tools/runTask.ts
      src/tools/reviewFile.ts
      src/tools/getTaskStatus.ts
      src/tools/readTaskOutput.ts
      src/tools/cancelTask.ts
      tests/mcp-tools.test.ts
    daemon/
      package.json
      src/index.ts
      src/httpServer.ts
      tests/daemon-api.test.ts
  packages/
    core/
      src/types.ts
      src/schemas.ts
      src/errors.ts
      src/pathPolicy.ts
      src/promptTemplates.ts
      tests/pathPolicy.test.ts
      tests/promptTemplates.test.ts
    daemon-client/
      src/daemonClient.ts
      tests/daemonClient.test.ts
    provider/
      src/providerConfig.ts
      src/providerRegistry.ts
      src/modelResolver.ts
      tests/providerRegistry.test.ts
    secrets/
      src/secretStore.ts
      src/windowsCredentialStore.ts
      src/dpapiStore.ts
      tests/secretStore.test.ts
    storage/
      src/database.ts
      src/migrations.ts
      src/taskStore.ts
      src/providerStore.ts
      src/settingsStore.ts
      tests/taskStore.test.ts
    runner/
      src/claudeRunner.ts
      src/outputParser.ts
      src/processTree.ts
      src/claudeBinary.ts
      tests/outputParser.test.ts
      tests/claudeRunner.test.ts
    proxy/
      src/proxyServer.ts
      src/portAllocator.ts
      src/anthropicToOpenAI.ts
      src/openAIToAnthropic.ts
      src/streamAdapter.ts
      tests/anthropicToOpenAI.test.ts
      tests/streamAdapter.test.ts
```

---

## 5. Data Model

### 5.1 Provider Config

```ts
export type ProviderMode = "anthropic-compatible" | "openai-compatible";

export interface ProviderConfig {
  id: string;
  displayName: string;
  mode: ProviderMode;
  baseUrl: string;
  apiKeyRef: string;
  auth: {
    header: "Authorization" | "x-api-key";
    scheme: "Bearer" | "Raw";
  };
  models: {
    default: string;
    review?: string;
    fast?: string;
    reasoning?: string;
  };
  capabilities: {
    streaming: boolean;
    tools: boolean;
    systemPrompt: boolean;
    thinking?: boolean;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### 5.2 Task Request

```ts
export interface RunTaskRequest {
  provider: string;
  model?: string;
  cwd: string;
  prompt: string;
  files?: string[];
  mode?: "sync" | "async";
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ReviewFileRequest {
  provider: string;
  model?: string;
  cwd: string;
  file: string;
  reviewStyle?: "bugs" | "architecture" | "language" | "full";
  language?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}
```

### 5.3 Task Result

```ts
export type TerminalTaskStatus = "ok" | "error" | "cancelled" | "timeout";

export interface TaskResult {
  status: TerminalTaskStatus;
  taskId: string;
  provider: string;
  model: string;
  cwd: string;
  summary?: string;
  content?: string;
  error?: {
    code: string;
    message: string;
    detail?: string;
  };
  logsRef: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface DaemonSettings {
  daemon: {
    host: "127.0.0.1";
    port: number;
    authTokenRef: string;
  };
  claude: {
    path: string;
    requiredVersion?: string;
  };
  workspace: {
    allowedRoots: string[];
  };
  proxy: {
    portStart: number;
    portEnd: number;
  };
  tasks: {
    defaultTimeoutMs: number;
    maxOutputBytes: number;
    maxConcurrentTasks: number;
    overflow: "reject" | "queue";
    logRetentionDays: number;
  };
}
```

---

## 6. MCP Tool Contract

### 6.1 `ccagent.list_providers`

Input:

```json
{}
```

Output:

```json
{
  "providers": [
    {
      "id": "glm",
      "displayName": "Zhipu GLM",
      "enabled": true,
      "mode": "openai-compatible",
      "models": ["glm-5.1", "glm-4.6"]
    }
  ]
}
```

### 6.2 `ccagent.test_provider`

Input:

```json
{
  "provider": "glm",
  "model": "glm-5.1"
}
```

Output:

```json
{
  "status": "ok",
  "latencyMs": 2300,
  "message": "Provider test succeeded."
}
```

### 6.3 `ccagent.run_task`

Input:

```json
{
  "provider": "glm",
  "model": "glm-5.1",
  "cwd": "D:/project",
  "prompt": "Review test.md and return concise findings.",
  "files": ["test.md"],
  "mode": "sync",
  "timeoutMs": 600000
}
```

Output: `TaskResult`.

### 6.4 `ccagent.review_file`

Input:

```json
{
  "provider": "glm",
  "model": "glm-5.1",
  "cwd": "D:/project",
  "file": "test.md",
  "reviewStyle": "full",
  "timeoutMs": 600000
}
```

Output: `TaskResult`.

### 6.5 `ccagent.get_task_status`

Input:

```json
{
  "taskId": "task_20260605_000001"
}
```

Output:

```json
{
  "taskId": "task_20260605_000001",
  "status": "running",
  "provider": "glm",
  "model": "glm-5.1",
  "startedAt": "2026-06-05T10:00:00+08:00",
  "durationMs": 82000
}
```

### 6.6 `ccagent.read_task_output`

Input:

```json
{
  "taskId": "task_20260605_000001",
  "maxBytes": 65536
}
```

Output:

```json
{
  "taskId": "task_20260605_000001",
  "status": "ok",
  "content": "...",
  "truncated": false
}
```

### 6.7 `ccagent.cancel_task`

Input:

```json
{
  "taskId": "task_20260605_000001"
}
```

Output:

```json
{
  "taskId": "task_20260605_000001",
  "status": "cancelled"
}
```

---

## 7. Provider Routing

### 7.1 Anthropic-Compatible Provider

For providers with native Anthropic Messages compatibility:

```text
ANTHROPIC_BASE_URL=<provider anthropic base url>
ANTHROPIC_AUTH_TOKEN=<provider api key>
ANTHROPIC_MODEL=<resolved model>
ANTHROPIC_DEFAULT_SONNET_MODEL=<resolved model>
ANTHROPIC_DEFAULT_HAIKU_MODEL=<resolved model>
ANTHROPIC_DEFAULT_OPUS_MODEL=<resolved model>
```

The runner starts Claude Code with these variables injected only into the child process. It never modifies global `~/.claude/settings.json` for task execution.

### 7.2 OpenAI-Compatible Provider

For GLM, DeepSeek, or other OpenAI-compatible providers:

```text
Codex -> MCP -> Daemon -> ClaudeRunner
ClaudeRunner env:
  ANTHROPIC_BASE_URL=http://127.0.0.1:<taskPort>
  ANTHROPIC_AUTH_TOKEN=ccagent-local-<taskId>
  ANTHROPIC_MODEL=<resolved model>

Claude Code -> local proxy /v1/messages
Local proxy -> provider /chat/completions
```

Each task gets its own proxy instance or task-bound route on an isolated port. The proxy validates the local token so a task cannot accidentally use another task's upstream provider.

---

## 8. Protocol Conversion Requirements

### 8.1 Anthropic Messages to OpenAI Chat Completions

Conversion rules:

- Anthropic `system` becomes the first OpenAI `system` message.
- Anthropic `messages[].role=user` maps to OpenAI `user`.
- Anthropic `messages[].role=assistant` maps to OpenAI `assistant`.
- Text content blocks are concatenated with clear separators.
- Image/file content blocks are rejected in first version unless provider capability explicitly supports them.
- Anthropic `max_tokens` maps to OpenAI `max_tokens` when supported.
- Anthropic `temperature`, `top_p`, `stop_sequences` map to OpenAI equivalents.
- Anthropic tools map to OpenAI tools when provider `capabilities.tools=true`.
- If Claude Code sends unsupported content, proxy returns an Anthropic-shaped error response.

### 8.2 OpenAI Response to Anthropic Messages

Conversion rules:

- OpenAI assistant message `content` becomes Anthropic `content: [{ type: "text", text }]`.
- OpenAI `finish_reason=stop` maps to Anthropic `stop_reason=end_turn`.
- OpenAI `finish_reason=length` maps to Anthropic `stop_reason=max_tokens`.
- OpenAI `tool_calls` map to Anthropic `tool_use` content blocks.
- Provider errors map to Anthropic error shape with original provider code preserved in `detail`.

### 8.3 Streaming

Streaming is required because Claude Code may expect streaming behavior.

- Accept Anthropic stream request.
- Call OpenAI-compatible upstream with `stream=true`.
- Convert OpenAI SSE chunks into Anthropic-compatible SSE events.
- Emit message start, content block start, text deltas, content block stop, message delta, and message stop.
- Log raw provider chunks only when debug logging is enabled; redact API keys.

---

## 9. Claude Code Runner

Runner command shape:

```text
claude -p "<prompt>" --output-format json
```

For long or streaming tasks, use:

```text
claude -p "<prompt>" --output-format stream-json
```

Runner responsibilities:

- Resolve `claude` binary path from config or PATH.
- Validate `cwd` against allowed roots.
- Build task-specific env without modifying global settings.
- Start child process.
- Capture stdout/stderr incrementally.
- Parse JSON/stream-json output.
- Enforce timeout.
- Kill process tree on cancellation.
- Stop per-task proxy after task completion.
- Persist task logs and final result.

The prompt passed to Claude Code should include the file path and instruction, not raw file contents by default. Claude Code should read files from `cwd`, preserving its normal coding-agent behavior.

---

## 10. Prompt Templates

### 10.1 Review File Template

```text
You are reviewing a local document for the user.

Task:
Review the file: {file}

Review style: {reviewStyle}

Return the result in {language}. If request.language is not provided, use Chinese unless the file itself clearly requires another language.
Lead with findings ordered by severity. For each issue include:
- title
- evidence from the file
- why it matters
- suggested change

If no actionable issues are found, say that clearly and mention any residual uncertainty.
Do not modify the file.
```

### 10.2 Generic Run Task Template

For `run_task`, use the prompt exactly as provided by Codex, with a small system wrapper only when necessary:

```text
Execute the following task in the working directory.

{prompt}

Return the final answer clearly. If you inspect or modify files, summarize the exact files involved.
```

---

## 11. Security Model

### 11.1 Workspace Policy

- Store allowed roots in config.
- Reject `cwd` outside allowed roots.
- Resolve paths with `realpath`/canonicalization before validation.
- Reject symlink escapes.
- Reject absolute file paths outside `cwd` unless they are inside allowed roots.
- Reject path segments that resolve above `cwd` for file-specific tools.

### 11.2 Secret Policy

- API keys are stored in authenticated encrypted local storage; a Windows Credential Manager backend can replace it later behind the same `SecretStore` interface.
- MCP tools never return API keys.
- Logs redact API keys, bearer tokens, local proxy task tokens, and Authorization headers.
- GUI displays only masked key fingerprints such as `sk-...abcd`.

### 11.3 Execution Policy

- CCAgent may launch only the configured Claude Code binary.
- CCAgent should not expose a general shell execution tool.
- MCP arguments cannot override arbitrary environment variables.
- Custom provider base URLs are allowed only if the user enables custom providers in GUI.

---

## 12. Implementation Source of Truth

Part B is the only executable coding task breakdown. The Master Task Tracker at the top of this file mirrors Part B's 18 tasks and should be used for progress tracking.

Part A intentionally does not maintain a second numbered implementation list. Architectural requirements from Part A must be implemented by the corresponding Part B task:

- Core contracts and path policy: Part B Tasks 2-3.
- Prompt templates: Part B Task 4.
- Provider, secret, and storage layers: Part B Tasks 5-7.
- Proxy protocol and server behavior: Part B Tasks 8-11.
- Runner, daemon, shared daemon client, and MCP server: Part B Tasks 12-15.
- GUI, end-to-end tests, docs, and packaging: Part B Tasks 16-18.

---

## 13. Validation Plan

Run before considering first version complete:

```text
pnpm typecheck
pnpm test
pnpm playwright test
pnpm build
```

Manual validation:

1. Configure GLM provider in GUI.
2. Save API key and confirm only masked fingerprint is shown.
3. Register CCAgent MCP server in Codex.
4. Ask Codex to call `ccagent.review_file` on a local `test.md`.
5. Confirm Claude Code starts with task-specific env.
6. Confirm task appears in GUI as running.
7. Confirm result returns to Codex.
8. Start a second task with another provider while first is running.
9. Confirm each task uses a different proxy port or direct provider env.
10. Cancel one task and confirm the other continues unaffected.

---

## 14. Acceptance Criteria

The first version is complete when:

- Codex can call CCAgent through MCP without shell command wrapping.
- `review_file` works for at least one Anthropic-compatible provider and one OpenAI-compatible provider.
- Multiple concurrent Claude Code tasks can run with different providers without shared API state.
- No task execution modifies global Claude Code settings.
- GUI can create providers, store keys, test providers, and show task history.
- API keys are not exposed through MCP, logs, or GUI output.
- Path policy blocks access outside allowed workspace roots.
- Timeout and cancellation work reliably.
- Daemon startup recovery does not leave previously running tasks stuck forever.
- Task concurrency is bounded by configuration.
- Per-task proxy ports are allocated without races and are released after task completion.
- All unit, integration, e2e, and GUI smoke tests pass.

---

## 15. Main Risks and Mitigations

### Risk: Claude Code sends Anthropic features not supported by a provider

Mitigation: proxy rejects unsupported content with clear Anthropic-shaped error; provider capability config controls tools, streaming, system prompt, and multimodal support.

### Risk: OpenAI-compatible streaming differs by provider

Mitigation: stream adapter is tested against provider-specific fixtures; proxy logs redacted raw stream chunks in debug mode.

### Risk: child process cancellation leaves orphan processes

Mitigation: use process-tree termination on Windows and verify with e2e cancellation tests.

### Risk: task output is too large for MCP response

Mitigation: MCP result returns summary/content up to `maxOutputBytes`; full logs are available through `read_task_output`.

### Risk: provider config changes affect running tasks

Mitigation: snapshot provider config and secret fingerprint at task start; running tasks do not read mutable provider state again.

### Risk: daemon crash leaves inconsistent local state

Mitigation: on daemon startup, mark persisted `pending` and `running` tasks from the previous daemon session as `error` with `CCAGENT_DAEMON_RECOVERED`, and clean any known task proxy registrations.

### Risk: unbounded task starts exhaust local resources

Mitigation: enforce `tasks.maxConcurrentTasks`; when the limit is reached, reject or queue new tasks according to daemon configuration.

---

## 16. Suggested Implementation Order

Implement in this order because each layer becomes a dependency for the next:

1. Monorepo scaffolding.
2. Shared types and schemas.
3. Path policy.
4. Prompt templates.
5. Provider registry.
6. Secret store.
7. SQLite storage.
8. Proxy fixtures and protocol types.
9. Proxy conversion.
10. Streaming adapter.
11. Proxy server.
12. Runner parser.
13. Claude runner.
14. Daemon API and shared daemon client.
15. MCP server.
16. GUI.
17. End-to-end tests.
18. Documentation and packaging.

This order keeps the core execution path testable before GUI work, while still delivering GUI, MCP, proxy, and runner in the same first version.

---

# Part B: Executable Coding Task Breakdown

# CCAgent Coding Task Breakdown

This document turns `ccagent-first-version-implementation-plan.md` into an executable engineering task list. It is intended for a developer who should be able to implement CCAgent without reinterpreting the architecture.

## Fixed Decisions

Use these decisions unless the requester explicitly changes them.

- Runtime: Node.js 22 LTS.
- Language: TypeScript, ESM modules.
- Package manager: pnpm workspace.
- MCP transport: stdio.
- Daemon transport: local HTTP on `127.0.0.1`, default port `47621`.
- Daemon auth: local bearer token stored in config and passed to MCP/GUI.
- GUI: Electron + React + Vite.
- Database: SQLite through `better-sqlite3`.
- Tests: Vitest for unit/integration, Playwright for GUI smoke.
- Provider proxy HTTP framework: Fastify.
- Child process runner: `execa` plus Windows process-tree termination helper.
- Secret storage on Windows: authenticated encrypted file backend by default, with `SecretStore` kept as the interface boundary for a future Credential Manager backend.
- Claude execution: never write `~/.claude/settings.json`; inject env per child process only.
- Daemon client: shared package used by both MCP server and GUI, not duplicated per app.
- Test coverage: Vitest coverage must be configured with project-level 80% thresholds for statements, branches, functions, and lines.
- Security default: `workspace.allowedRoots` defaults to `[]`; the GUI or user config must explicitly add roots before file-reading tasks can run.

## Workspace Layout

Create this exact layout:

```text
ccagent/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  vitest.config.ts
  apps/
    daemon/
    gui/
    mcp-server/
  packages/
    core/
    daemon-client/
    provider/
    proxy/
    runner/
    secrets/
    storage/
  docs/
  scripts/
  tests/
    e2e/
    fixtures/
```

Every package must have its own `package.json`, `tsconfig.json`, and `src/index.ts` export surface.

---

## Task 1: Monorepo Scaffolding

### Files

Create:

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `vitest.config.ts`
- `apps/daemon/package.json`
- `apps/mcp-server/package.json`
- `apps/gui/package.json`
- `packages/core/package.json`
- `packages/daemon-client/package.json`
- `packages/provider/package.json`
- `packages/proxy/package.json`
- `packages/runner/package.json`
- `packages/secrets/package.json`
- `packages/storage/package.json`

### Required Root `package.json`

```json
{
  "name": "ccagent",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev:daemon": "pnpm --filter @ccagent/daemon dev",
    "dev:mcp": "pnpm --filter @ccagent/mcp-server dev",
    "dev:gui": "pnpm --filter @ccagent/gui dev"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "@vitest/coverage-v8": "^2.1.0",
    "tsx": "^4.19.0"
  }
}
```

### Required `vitest.config.ts`

Configure V8 coverage with minimum thresholds of 80% for statements, branches, functions, and lines.

### Required `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### Verification

Run:

```bash
pnpm install
pnpm typecheck
pnpm test
```

Expected:

- Install succeeds.
- Typecheck has no errors.
- Vitest reports no failing tests.
- Coverage thresholds are active in CI/test configuration.

---

## Task 2: Core Types, Errors, and Schemas

### Files

Create:

- `packages/core/src/types.ts`
- `packages/core/src/errors.ts`
- `packages/core/src/schemas.ts`
- `packages/core/src/index.ts`
- `packages/core/tests/schemas.test.ts`

### Types To Implement

```ts
export type ProviderMode = "anthropic-compatible" | "openai-compatible";
export type TaskStatus = "pending" | "running" | "ok" | "error" | "cancelled" | "timeout";
export type TerminalTaskStatus = "ok" | "error" | "cancelled" | "timeout";
export type ReviewStyle = "bugs" | "architecture" | "language" | "full";

export interface ProviderConfig {
  id: string;
  displayName: string;
  mode: ProviderMode;
  baseUrl: string;
  apiKeyRef: string;
  auth: {
    header: "Authorization" | "x-api-key";
    scheme: "Bearer" | "Raw";
  };
  models: {
    default: string;
    review?: string;
    fast?: string;
    reasoning?: string;
  };
  capabilities: {
    streaming: boolean;
    tools: boolean;
    systemPrompt: boolean;
    thinking?: boolean;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunTaskRequest {
  provider: string;
  model?: string;
  cwd: string;
  prompt: string;
  files?: string[];
  mode?: "sync" | "async";
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ReviewFileRequest {
  provider: string;
  model?: string;
  cwd: string;
  file: string;
  reviewStyle?: ReviewStyle;
  language?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface TaskResult {
  status: TerminalTaskStatus;
  taskId: string;
  provider: string;
  model: string;
  cwd: string;
  summary?: string;
  content?: string;
  error?: {
    code: string;
    message: string;
    detail?: string;
  };
  logsRef: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface DaemonSettings {
  daemon: {
    host: "127.0.0.1";
    port: number;
    authTokenRef: string;
  };
  claude: {
    path: string;
    requiredVersion?: string;
  };
  workspace: {
    allowedRoots: string[];
  };
  proxy: {
    portStart: number;
    portEnd: number;
  };
  tasks: {
    defaultTimeoutMs: number;
    maxOutputBytes: number;
    maxConcurrentTasks: number;
    overflow: "reject" | "queue";
    logRetentionDays: number;
  };
}
```

### Errors To Implement

```ts
export class CCAgentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "CCAgentError";
  }
}

export const ErrorCodes = {
  PathDenied: "CCAGENT_PATH_DENIED",
  ProviderMissing: "CCAGENT_PROVIDER_MISSING",
  ProviderDisabled: "CCAGENT_PROVIDER_DISABLED",
  SecretMissing: "CCAGENT_SECRET_MISSING",
  ClaudeNotFound: "CCAGENT_CLAUDE_NOT_FOUND",
  ClaudeMissing: "CCAGENT_CLAUDE_NOT_FOUND",
  ClaudeUnsupported: "CCAGENT_CLAUDE_UNSUPPORTED",
  TaskMissing: "CCAGENT_TASK_MISSING",
  TaskLimit: "CCAGENT_TASK_LIMIT",
  Timeout: "CCAGENT_TIMEOUT",
  Cancelled: "CCAGENT_CANCELLED",
  ProxyUnsupported: "CCAGENT_PROXY_UNSUPPORTED",
  ProxyPortUnavailable: "CCAGENT_PROXY_PORT_UNAVAILABLE",
  ParseError: "CCAGENT_PARSE_ERROR",
  DaemonUnavailable: "CCAGENT_DAEMON_UNAVAILABLE",
  DaemonAuthUnavailable: "CCAGENT_DAEMON_AUTH_UNAVAILABLE",
  DaemonRecovered: "CCAGENT_DAEMON_RECOVERED"
} as const;
```

### Zod Schemas

Create schemas named:

- `ProviderConfigSchema`
- `RunTaskRequestSchema`
- `ReviewFileRequestSchema`
- `TaskResultSchema`
- `TaskIdRequestSchema`
- `ReadTaskOutputRequestSchema`

Validation rules:

- provider id: `/^[a-zA-Z0-9_-]{1,64}$/`
- timeout: min `1000`, max `3600000`, default `600000`
- maxOutputBytes: min `1024`, max `1048576`, default `131072`
- file path must be non-empty string; path policy validates canonical path later

### Tests

Test at least:

- valid `RunTaskRequest` parses.
- invalid provider id fails.
- timeout above max fails.
- `reviewStyle` defaults to `full`.
- `mode` defaults to `sync`.

---

## Task 3: Path Policy

### Files

Create:

- `packages/core/src/pathPolicy.ts`
- `packages/core/tests/pathPolicy.test.ts`

### Functions

```ts
export interface PathPolicy {
  allowedRoots: string[];
}

export function normalizePathForPolicy(input: string): string;
export function assertCwdAllowed(cwd: string, policy: PathPolicy): string;
export function assertFileInsideCwd(cwd: string, file: string): string;
export function isInside(parent: string, child: string): boolean;
```

### Behavior

- Resolve all paths with `path.resolve`.
- Compare case-insensitively on Windows.
- `assertCwdAllowed` returns normalized absolute cwd.
- `assertFileInsideCwd` resolves relative file paths against cwd.
- Reject paths escaping cwd through `..`.
- Throw `CCAgentError(ErrorCodes.PathDenied, ...)` on denial.

### Tests

Use Windows-style paths in tests:

- `D:/project` allowed under `D:/project`.
- `D:/project/docs/test.md` inside `D:/project`.
- `../secret.txt` from `D:/project/docs` is denied if it resolves outside cwd.
- case-insensitive matching allows `d:/PROJECT` under `D:/project`.

---

## Task 4: Prompt Templates

### Files

Create:

- `packages/core/src/promptTemplates.ts`
- `packages/core/tests/promptTemplates.test.ts`

### Functions

```ts
import type { ReviewFileRequest } from "./types.js";

export function buildReviewFilePrompt(request: ReviewFileRequest): string;
export function buildRunTaskPrompt(prompt: string): string;
```

### Required Review Prompt

The generated review prompt must contain:

```text
You are reviewing a local document for the user.

Task:
Review the file: <file>

Review style: <style>

Return the result in <language>. If request.language is not provided, use Chinese unless the file itself clearly requires another language.
Lead with findings ordered by severity. For each issue include:
- title
- evidence from the file
- why it matters
- suggested change

If no actionable issues are found, say that clearly and mention any residual uncertainty.
Do not modify the file.
```

### Tests

- Prompt includes file path.
- Prompt includes style.
- Prompt uses `request.language` when provided and falls back to Chinese guidance otherwise.
- Prompt includes `Do not modify the file.`.
- `buildRunTaskPrompt` wraps the raw prompt and preserves original text.

---

## Task 5: Provider Registry

### Files

Create:

- `packages/provider/src/providerRegistry.ts`
- `packages/provider/src/modelResolver.ts`
- `packages/provider/src/defaultProviders.ts`
- `packages/provider/src/index.ts`
- `packages/provider/tests/providerRegistry.test.ts`

### Interfaces

```ts
import type { ProviderConfig } from "@ccagent/core";

export interface ProviderStoreLike {
  listProviders(): Promise<ProviderConfig[]>;
  getProvider(id: string): Promise<ProviderConfig | undefined>;
  saveProvider(provider: ProviderConfig): Promise<void>;
  deleteProvider(id: string): Promise<void>;
}

export class ProviderRegistry {
  constructor(private readonly store: ProviderStoreLike) {}
  list(): Promise<ProviderConfig[]>;
  getEnabled(id: string): Promise<ProviderConfig>;
  save(provider: ProviderConfig): Promise<void>;
  delete(id: string): Promise<void>;
}

export function resolveModel(provider: ProviderConfig, requested?: string, purpose?: "review" | "fast" | "reasoning"): string;
```

### Default Provider Templates

Create `defaultProviders.ts` with templates but no API keys:

```ts
export const defaultProviderTemplates = [
  {
    id: "deepseek",
    displayName: "DeepSeek",
    mode: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    auth: { header: "Authorization", scheme: "Bearer" },
    models: { default: "deepseek-v4-flash", review: "deepseek-v4-flash" },
    capabilities: { streaming: true, tools: true, systemPrompt: true }
  },
  {
    id: "glm",
    displayName: "Zhipu GLM",
    mode: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    auth: { header: "Authorization", scheme: "Bearer" },
    models: { default: "glm-5.1", review: "glm-5.1" },
    capabilities: { streaming: true, tools: true, systemPrompt: true }
  }
] as const;
```

Provider URLs and model IDs were verified against official provider docs on 2026-06-05. GLM keeps `glm-5.1` on `https://open.bigmodel.cn/api/paas/v4`; DeepSeek keeps `https://api.deepseek.com` and uses `deepseek-v4-flash` because `deepseek-chat` is deprecated on 2026-07-24.

### Tests

- `getEnabled` throws `ProviderMissing` for unknown provider.
- `getEnabled` throws `ProviderDisabled` for disabled provider.
- `resolveModel(provider, "x")` returns `x`.
- `resolveModel(provider, undefined, "review")` returns `provider.models.review` when present.
- fallback returns `provider.models.default`.

---

## Task 6: Secret Store

### Files

Create:

- `packages/secrets/src/secretStore.ts`
- `packages/secrets/src/memorySecretStore.ts`
- `packages/secrets/src/windowsCredentialStore.ts`
- `packages/secrets/src/dpapiStore.ts`
- `packages/secrets/src/index.ts`
- `packages/secrets/tests/secretStore.test.ts`

### Interface

```ts
export interface SecretStore {
  set(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string>;
  delete(ref: string): Promise<void>;
  has(ref: string): Promise<boolean>;
  fingerprint(ref: string): Promise<string>;
}
```

### Behavior

- `get` throws `SecretMissing` when absent.
- `fingerprint` returns `prefix...suffix`, for example `sk-...abcd`.
- Never log secret values.
- `memorySecretStore` is only for tests.
- `dpapiStore` is the first-version production backend on Windows.
- `windowsCredentialStore` is an explicit future backend placeholder and must fail closed if selected before implementation.
- `dpapiStore` stores encrypted values under `%APPDATA%/CCAgent/secrets.enc.json`.

### Tests

- set/get/delete works.
- fingerprint masks values.
- missing key throws `CCAGENT_SECRET_MISSING`.

---

## Task 7: Storage

### Files

Create:

- `packages/storage/src/database.ts`
- `packages/storage/src/migrations.ts`
- `packages/storage/src/providerStore.ts`
- `packages/storage/src/taskStore.ts`
- `packages/storage/src/settingsStore.ts`
- `packages/storage/src/index.ts`
- `packages/storage/tests/taskStore.test.ts`
- `packages/storage/tests/providerStore.test.ts`

### Tables

```sql
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  error_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  stream TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
```

### Database Behavior

- Enable SQLite WAL mode and set a non-zero `busy_timeout` during database initialization.
- Serialize writes through the storage API so concurrent daemon HTTP requests cannot interleave partial task updates.
- `settingsStore` owns daemon settings, workspace roots, task concurrency limits, and log retention settings.
- Raw API keys must never be stored in SQLite; only secret references and masked fingerprints are allowed.
- Provide a log cleanup method that deletes task log rows older than `tasks.logRetentionDays`.

### Store Methods

```ts
export interface TaskStore {
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  updateTask(id: string, patch: Partial<TaskRecord>): Promise<void>;
  appendLog(taskId: string, stream: "stdout" | "stderr" | "system", text: string): Promise<void>;
  getTask(id: string): Promise<TaskRecord | undefined>;
  readOutput(id: string, maxBytes: number): Promise<{ content: string; truncated: boolean }>;
  listTasks(limit: number): Promise<TaskRecord[]>;
}
```

### Tests

- provider save/get/list/delete.
- task lifecycle update.
- append/read logs.
- output truncation obeys `maxBytes`.
- settings store saves and loads daemon settings.
- WAL mode and `busy_timeout` are configured.
- concurrent task status updates remain consistent.

---

## Task 8: Proxy Type Fixtures

### Files

Create:

- `packages/proxy/src/protocolTypes.ts`
- `packages/proxy/tests/fixtures/anthropic-message-basic.json`
- `packages/proxy/tests/fixtures/openai-chat-basic.json`
- `packages/proxy/tests/fixtures/openai-chat-response-basic.json`
- `packages/proxy/tests/fixtures/anthropic-response-basic.json`

### Basic Anthropic Request Fixture

```json
{
  "model": "glm-5.1",
  "max_tokens": 1024,
  "system": "You are a reviewer.",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Review test.md" }
      ]
    }
  ],
  "stream": false
}
```

### Expected OpenAI Request Fixture

```json
{
  "model": "glm-5.1",
  "messages": [
    { "role": "system", "content": "You are a reviewer." },
    { "role": "user", "content": "Review test.md" }
  ],
  "max_tokens": 1024,
  "stream": false
}
```

### Basic OpenAI Response Fixture

```json
{
  "id": "chatcmpl-test",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Review result text"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 5,
    "total_tokens": 15
  }
}
```

### Expected Anthropic Response Fixture

```json
{
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "Review result text" }
  ],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 5
  }
}
```

---

## Task 9: Proxy Conversion

### Files

Create:

- `packages/proxy/src/anthropicToOpenAI.ts`
- `packages/proxy/src/openAIToAnthropic.ts`
- `packages/proxy/src/index.ts`
- `packages/proxy/tests/anthropicToOpenAI.test.ts`
- `packages/proxy/tests/openAIToAnthropic.test.ts`

### Functions

```ts
export function anthropicToOpenAI(input: AnthropicMessageRequest, modelOverride?: string): OpenAIChatRequest;
export function openAIToAnthropic(input: OpenAIChatResponse): AnthropicMessageResponse;
```

### Required Behavior

- Supports text-only messages.
- Supports system prompt.
- Supports max tokens, temperature, top_p, stop sequences.
- Rejects image/tool blocks until tool conversion tests are added.
- Maps `finish_reason: "stop"` to `stop_reason: "end_turn"`.
- Maps `finish_reason: "length"` to `stop_reason: "max_tokens"`.

### Tests

- Fixture request converts exactly to expected fixture.
- Fixture response converts exactly to expected fixture.
- Unsupported content block throws `CCAGENT_PROXY_UNSUPPORTED`.

---

## Task 10: Streaming Adapter

### Files

Create:

- `packages/proxy/src/streamAdapter.ts`
- `packages/proxy/tests/streamAdapter.test.ts`

### Functions

```ts
export async function* openAIStreamToAnthropicEvents(chunks: AsyncIterable<string>): AsyncIterable<string>;
```

### Behavior

Input chunks are OpenAI SSE lines. Output chunks are Anthropic-compatible SSE text lines.

Minimum output sequence:

```text
event: message_start
data: {...}

event: content_block_start
data: {...}

event: content_block_delta
data: {...}

event: content_block_stop
data: {...}

event: message_stop
data: {...}
```

### Tests

- Single OpenAI delta emits message start, content block start, delta, block stop, message stop.
- `[DONE]` closes stream.
- Malformed JSON emits an error event and stops.
- Upstream close before `[DONE]` emits an Anthropic-shaped error event and marks the task as failed.
- Provider rate-limit or network errors preserve any already logged partial stream text but return terminal task status `error`.

---

## Task 11: Proxy Server

### Files

Create:

- `packages/proxy/src/proxyServer.ts`
- `packages/proxy/src/portAllocator.ts`
- `packages/proxy/tests/proxyServer.test.ts`
- `packages/proxy/tests/portAllocator.test.ts`

### Interfaces

```ts
export interface ProxyTaskConfig {
  taskId: string;
  localToken: string;
  listenHost: "127.0.0.1";
  port: number;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  upstreamAuth: {
    header: "Authorization" | "x-api-key";
    scheme: "Bearer" | "Raw";
  };
  model: string;
  streaming: boolean;
}

export interface StartedProxy {
  taskId: string;
  baseUrl: string;
  stop(): Promise<void>;
}

export async function startProxy(config: ProxyTaskConfig): Promise<StartedProxy>;
```

### Behavior

- Listen only on `127.0.0.1`.
- Accept `POST /v1/messages`.
- Accept `GET /v1/models` and return a minimal model list containing the configured task model.
- Validate `Authorization: Bearer <localToken>` or raw token equivalent.
- Convert request to OpenAI format.
- POST to `<upstreamBaseUrl>/chat/completions`.
- Convert response back to Anthropic format.
- Redact tokens in all logs.
- Allocate ports through a single in-process allocator that binds a candidate port before returning it; never choose a port only by scanning.
- Release allocated ports only after `stop()` completes.
- Return `CCAGENT_PROXY_PORT_UNAVAILABLE` when the configured range is exhausted.

### Tests

- Unauthorized request returns 401.
- Authorized non-stream request reaches fake provider.
- Response is converted back to Anthropic shape.
- `stop()` closes port.
- concurrent proxy starts never receive the same port.
- `/v1/models` returns the configured task model.

---

## Task 12: Runner Output Parser

### Files

Create:

- `packages/runner/src/outputParser.ts`
- `packages/runner/tests/outputParser.test.ts`
- `packages/runner/tests/fixtures/claude-json-output.json`
- `packages/runner/tests/fixtures/claude-stream-json-output.ndjson`

### Expected Claude JSON Fixture

Use this fixture for fake runner tests:

```json
{
  "type": "result",
  "subtype": "success",
  "result": "Review result text",
  "session_id": "test-session",
  "total_cost_usd": 0.01,
  "duration_ms": 1000
}
```

### Functions

```ts
export interface ParsedClaudeOutput {
  content: string;
  summary?: string;
  raw: string;
}

export function parseClaudeJsonOutput(stdout: string): ParsedClaudeOutput;
export function parseClaudeStreamJsonOutput(stdout: string): ParsedClaudeOutput;
```

### Behavior

- For JSON output, prefer `result` string.
- For stream-json output, concatenate final result messages; if a `result` event exists, prefer it.
- Throw `CCAGENT_PARSE_ERROR` for malformed output.

### Tests

- JSON fixture returns `Review result text`.
- NDJSON fixture returns final result.
- malformed JSON throws parse error.

---

## Task 13: Claude Runner

### Files

Create:

- `packages/runner/src/claudeRunner.ts`
- `packages/runner/src/processTree.ts`
- `packages/runner/src/claudeBinary.ts`
- `packages/runner/src/index.ts`
- `packages/runner/tests/claudeRunner.test.ts`
- `tests/fixtures/fake-claude.ts`

### Interfaces

```ts
export interface ClaudeRunInput {
  taskId: string;
  cwd: string;
  prompt: string;
  claudePath: string;
  env: Record<string, string>;
  timeoutMs: number;
  outputFormat: "json" | "stream-json";
  onStdout(text: string): void;
  onStderr(text: string): void;
  signal?: AbortSignal;
}

export async function runClaude(input: ClaudeRunInput): Promise<ParsedClaudeOutput>;
```

### Behavior

- Command: `<claudePath> -p <prompt> --output-format <outputFormat>`.
- cwd: validated daemon cwd.
- env: merge process env plus task env; task env wins.
- Before first task execution, run `<claudePath> --version` and return `CCAGENT_CLAUDE_NOT_FOUND` or `CCAGENT_CLAUDE_UNSUPPORTED` when the binary is missing or incompatible.
- On timeout, terminate process tree and throw `CCAGENT_TIMEOUT`.
- On abort, terminate process tree and throw `CCAGENT_CANCELLED`.
- Windows process-tree termination must use `taskkill /PID <pid> /T /F` or a tested equivalent helper; `execa.cancel()` alone is not sufficient.
- If exit code non-zero, throw structured error including stderr.

### Tests

- fake Claude success returns parsed content.
- fake Claude stderr and non-zero exit returns error.
- abort signal cancels long-running fake Claude.
- timeout cancels long-running fake Claude.
- Windows process-tree helper invokes tree termination for a parent with child processes.
- missing or incompatible Claude binary reports a structured startup error.

---

## Task 14: Daemon API

### Files

Create:

- `apps/daemon/src/config.ts`
- `apps/daemon/src/httpServer.ts`
- `apps/daemon/src/taskManager.ts`
- `apps/daemon/src/index.ts`
- `packages/daemon-client/src/daemonClient.ts`
- `packages/daemon-client/src/index.ts`
- `packages/daemon-client/tests/daemonClient.test.ts`
- `apps/daemon/tests/daemon-api.test.ts`

### Config File

Store under `%APPDATA%/CCAgent/config.json`:

```json
{
  "daemon": {
    "host": "127.0.0.1",
    "port": 47621,
    "authTokenRef": "ccagent/daemon/token"
  },
  "claude": {
    "path": "claude",
    "requiredVersion": ">=1.0.0"
  },
  "workspace": {
    "allowedRoots": []
  },
  "proxy": {
    "portStart": 31000,
    "portEnd": 31999
  },
  "tasks": {
    "defaultTimeoutMs": 600000,
    "maxOutputBytes": 131072,
    "maxConcurrentTasks": 4,
    "overflow": "reject",
    "logRetentionDays": 30
  }
}
```

The empty `allowedRoots` default is intentional. The first run flow must prompt the user to add explicit workspace roots before accepting file-reading tasks.

### Auth Token Lifecycle

- On first startup, if `daemon.authTokenRef` is missing from SecretStore, generate a cryptographically random bearer token and store it under that ref.
- If the token cannot be read or generated, daemon startup fails with `CCAGENT_DAEMON_AUTH_UNAVAILABLE`.
- Provide an authenticated token-rotation endpoint or GUI action before release.
- Token rotation flow: daemon generates a new token, stores it under `daemon.authTokenRef`, returns it only in the rotation response to the authenticated caller, and the caller updates its in-memory `DaemonClient`. Other clients must reread the token from SecretStore/config before their next daemon call.
- Never write the bearer token into logs, MCP output, GUI renderer state, or SQLite.

### HTTP Endpoints

- `GET /health`
- `GET /providers`
- `POST /providers`
- `DELETE /providers/:id`
- `POST /providers/:id/secret`
- `POST /providers/test`
- `POST /tasks`
- `GET /tasks/:id`
- `GET /tasks/:id/output?maxBytes=...`
- `GET /tasks/:id/logs?maxBytes=...`
- `POST /tasks/:id/cancel`
- `POST /settings/workspace-roots`
- `POST /auth/rotate-token`

All endpoints except `/health` require daemon bearer token.

Endpoint semantics:

- `GET /tasks/:id/output` returns parsed task result content and truncation metadata, suitable for MCP responses and GUI output preview.
- `GET /tasks/:id/logs` returns raw redacted task log streams (`stdout`, `stderr`, `system`) and truncation metadata for debugging.
- `logsRef` is an opaque daemon reference string, not an OS or GUI protocol handler. The first version resolves it only through `GET /tasks/:id/logs`.

### TaskManager Behavior

- On daemon startup, mark persisted `pending` and `running` tasks from any previous daemon session as `error` with code `CCAGENT_DAEMON_RECOVERED`.
- Enforce `tasks.maxConcurrentTasks`; when the limit is reached, use `tasks.overflow` to reject with `CCAGENT_TASK_LIMIT` or enqueue.
- Always generate `logsRef` values as `ccagent://tasks/<taskId>/logs` and resolve them through `GET /tasks/:id/logs`; if log storage fails, keep the same best-effort ref and return the stored task error from the logs endpoint.
- Run log cleanup according to `tasks.logRetentionDays`.
- Run Claude binary/version validation during daemon startup or provider test and surface failures in `/health`.

For `openai-compatible` provider:

1. Resolve provider and model.
2. Read API key from SecretStore.
3. Allocate free proxy port.
4. Start proxy with task-local token.
5. Set env:

```ts
{
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
  ANTHROPIC_AUTH_TOKEN: localToken,
  ANTHROPIC_MODEL: model,
  ANTHROPIC_DEFAULT_SONNET_MODEL: model,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
  ANTHROPIC_DEFAULT_OPUS_MODEL: model
}
```

For `anthropic-compatible` provider:

```ts
{
  ANTHROPIC_BASE_URL: provider.baseUrl,
  ANTHROPIC_AUTH_TOKEN: apiKey,
  ANTHROPIC_MODEL: model,
  ANTHROPIC_DEFAULT_SONNET_MODEL: model,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
  ANTHROPIC_DEFAULT_OPUS_MODEL: model
}
```

### Tests

- `/health` works without token.
- unauthorized protected request fails.
- first startup generates daemon bearer token.
- missing uncreatable bearer token fails with structured error.
- `POST /tasks` creates and completes fake task.
- default empty `allowedRoots` rejects file-reading tasks until configured.
- max concurrent task limit rejects or queues excess tasks.
- openai-compatible task starts proxy.
- cancellation updates status and stops proxy.
- daemon startup marks orphaned running tasks as recovered errors.
- `logsRef` can be resolved through the logs endpoint.
- shared `DaemonClient` sends auth header, parses errors, and is consumed by MCP and GUI code.

---

## Task 15: MCP Server

### Files

Create:

- `apps/mcp-server/src/index.ts`
- `apps/mcp-server/src/tools/listProviders.ts`
- `apps/mcp-server/src/tools/testProvider.ts`
- `apps/mcp-server/src/tools/runTask.ts`
- `apps/mcp-server/src/tools/reviewFile.ts`
- `apps/mcp-server/src/tools/getTaskStatus.ts`
- `apps/mcp-server/src/tools/readTaskOutput.ts`
- `apps/mcp-server/src/tools/cancelTask.ts`
- `apps/mcp-server/tests/mcp-tools.test.ts`

### MCP Server Behavior

- Use `@modelcontextprotocol/sdk`.
- Start stdio transport.
- Register tools with Zod-derived JSON schemas.
- Each tool calls daemon through `DaemonClient`.
- Import `DaemonClient` from `@ccagent/daemon-client`; do not duplicate HTTP/auth/error handling in the MCP app.
- Tool responses return JSON content as text plus structured data when SDK supports it.
- Never include API keys in returned content.

### Required Tools

- `ccagent.list_providers`
- `ccagent.test_provider`
- `ccagent.run_task`
- `ccagent.review_file`
- `ccagent.get_task_status`
- `ccagent.read_task_output`
- `ccagent.cancel_task`

### Tests

- Mock daemon client and verify each tool forwards correct payload.
- Invalid input fails schema validation.
- `review_file` builds a review prompt before calling daemon `/tasks`.

---

## Task 16: GUI

### Files

Create:

- `apps/gui/src/main/index.ts`
- `apps/gui/src/main/preload.ts`
- `apps/gui/src/renderer/App.tsx`
- `apps/gui/src/renderer/routes/ProvidersPage.tsx`
- `apps/gui/src/renderer/routes/TasksPage.tsx`
- `apps/gui/src/renderer/components/ProviderForm.tsx`
- `apps/gui/src/renderer/components/TaskTable.tsx`
- `apps/gui/tests/gui-smoke.spec.ts`

### GUI Pages

Provider page fields:

- Provider id
- Display name
- Mode
- Base URL
- Auth header
- Auth scheme
- Default model
- Review model
- Streaming checkbox
- Tools checkbox
- Enabled checkbox
- API key input
- Save button
- Test button

Task page columns:

- Task id
- Status
- Provider
- Model
- CWD
- Started time
- Duration
- Output preview
- Cancel button for running tasks
- View output button

### Behavior

- Main process starts daemon if not running.
- Daemon startup must be a single owner in the GUI main process; renderer must not spawn daemon processes.
- If daemon startup fails, show a recoverable error state with the structured daemon error code.
- Renderer talks through preload IPC only.
- GUI IPC must call the shared `@ccagent/daemon-client`.
- Provider save validates fields before daemon call.
- API key never returns to renderer after save.
- Task list refreshes every 2 seconds while page is open.
- Task table error rows display the structured error message, not only the `error` status label.
- Settings UI must let users add/remove explicit workspace roots because the default root list is empty.

### Tests

- GUI opens.
- Provider page renders form.
- Tasks page renders table.
- Mock daemon response populates providers.
- Error task rows render the error message.
- Workspace roots can be configured through settings IPC.

---

## Task 17: End-to-End Tests

### Files

Create:

- `tests/e2e/review-file-through-mcp.test.ts`
- `tests/e2e/concurrent-providers.test.ts`
- `tests/fixtures/fake-claude.ts`
- `tests/fixtures/fake-openai-provider.ts`
- `tests/fixtures/test.md`

### Fake Claude Behavior

`fake-claude.ts` must support:

```bash
fake-claude -p "..." --output-format json
```

It should print:

```json
{
  "type": "result",
  "subtype": "success",
  "result": "Fake review result for test.md",
  "session_id": "fake-session",
  "duration_ms": 100
}
```

### E2E Assertions

- MCP `review_file` returns `Fake review result for test.md`.
- Two concurrent tasks use two different proxy ports.
- Cancelling one task does not cancel the other.
- Task logs are readable after completion.
- Daemon startup recovery marks a persisted running task as `error`.
- Claude binary preflight reports a clear error when fake Claude is missing.

---

## Task 18: Documentation and Packaging

### Files

Create:

- `docs/codex-mcp-setup.md`
- `docs/provider-config.md`
- `docs/release-checklist.md`
- `scripts/package-windows.ts`

### `docs/codex-mcp-setup.md` Must Include

- How to start daemon.
- How to run GUI.
- How to register MCP server in Codex.
- Example `review_file` request.
- Example `run_task` request.
- Troubleshooting table for:
  - daemon unavailable
  - Claude binary missing
  - provider missing
  - API key missing
  - path denied
  - provider API error
  - empty workspace root configuration
  - max concurrent task limit reached
  - daemon recovered an orphaned running task

### `docs/provider-config.md` Must Include

- Built-in provider templates and whether each is Anthropic-compatible or OpenAI-compatible.
- A release checklist item to verify GLM and DeepSeek base URLs against current provider documentation before shipping.
- A first-version security note: Anthropic-compatible mode passes the provider key to the Claude child process environment; logs and UI must still redact it.
- A design note explaining local HTTP on `127.0.0.1` with bearer auth instead of localhost HTTPS for the first version.

### Release Checklist

- `pnpm typecheck` passes.
- `pnpm test` passes.
- Playwright GUI smoke passes.
- Manual provider test passes.
- GLM and DeepSeek template base URLs are verified against current provider docs.
- Codex MCP call returns result.
- Two-provider concurrency test passes.
- Port exhaustion behavior is tested.
- Daemon recovery behavior is tested.
- Coverage thresholds meet or exceed 80%.
- API keys are redacted from logs.

---

## Final Acceptance Test

A developer must demonstrate this scenario:

1. Start CCAgent daemon.
2. Start CCAgent GUI.
3. Configure GLM provider with API key and model `glm-5.1`.
4. Register CCAgent MCP server in Codex.
5. In Codex, call `ccagent.review_file` with:

```json
{
  "provider": "glm",
  "model": "glm-5.1",
  "cwd": "D:/project",
  "file": "test.md",
  "reviewStyle": "full",
  "timeoutMs": 600000
}
```

6. Confirm Codex receives review text.
7. Confirm GUI task dashboard shows the completed task.
8. Confirm no global Claude Code settings file was modified.
9. Start another task with DeepSeek while GLM task is running.
10. Confirm both tasks finish independently.
11. Confirm task cancellation kills only the selected task.
12. Confirm daemon startup recovery marks any orphaned running task as `error`.
13. Confirm max concurrent task limit is enforced.
14. Confirm proxy port exhaustion returns a structured error.
15. Confirm API keys are redacted from MCP output, GUI output, and logs.
16. Confirm GLM and DeepSeek template URLs were verified against current provider docs before release.

If any step fails, the implementation is not complete.
