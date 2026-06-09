# CCAgent GUI End-To-End Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the GUI-hosted fully automatic CCAgent review flow from target file to multi-provider Claude Code review, merged packet, Codex CLI edit, diff, and final report.

**Architecture:** Add an automation run layer above existing provider tasks and review batches. The daemon owns orchestration and persistence; the GUI accesses it through IPC and daemon HTTP APIs. Large artifacts are stored under `.ccagent/runs/<runId>` while SQLite stores indexes and statuses.

**Tech Stack:** TypeScript, Node HTTP server, Electron, React, SQLite via `node:sqlite`, Vitest.

---

### Task 1: Core Types, Schemas, And Template Rendering

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/core/src/promptTemplates.ts`
- Test: `packages/core/tests/promptTemplates.test.ts`

- [ ] **Step 1: Write failing tests for template validation and rendering**

Add tests covering `renderPromptTemplate`, `defaultClaudeReviewTemplate`, `defaultCodexEditTemplate`, missing variables, and automation request schema defaults.

- [ ] **Step 2: Implement minimal core types and schemas**

Add `PromptTemplate`, `PromptTemplateKind`, `AutomationRunRequest`, `AutomationRunStatus`, `AutomationProviderStatus`, and zod schemas for prompt templates and automation run creation.

- [ ] **Step 3: Add template renderer**

Implement exact `{variable}` replacement, required-variable validation, and default templates that match the design variables.

- [ ] **Step 4: Run focused core tests**

Run: `pnpm.cmd vitest run packages/core/tests/promptTemplates.test.ts packages/core/tests/schemas.test.ts`

### Task 2: Storage For Prompt Templates And Automation Runs

**Files:**
- Modify: `packages/storage/src/database.ts`
- Modify: `packages/storage/src/migrations.ts`
- Modify: `packages/storage/src/index.ts`
- Create: `packages/storage/src/promptTemplateStore.ts`
- Create: `packages/storage/src/automationRunStore.ts`
- Test: `packages/storage/tests/sqlitePersistence.test.ts`
- Create: `packages/storage/tests/automationRunStore.test.ts`

- [ ] **Step 1: Write failing store tests**

Cover creating/listing/updating/deleting templates, creating run records, updating run status, adding provider task links, and file-backed persistence across reopen.

- [ ] **Step 2: Add database tables and memory structures**

Add `prompt_templates`, `automation_runs`, `automation_run_providers`, and `codex_edit_tasks` tables plus equivalent `MemoryDatabase` collections.

- [ ] **Step 3: Implement stores**

Implement `SqlitePromptTemplateStore` and `SqliteAutomationRunStore` following existing store patterns.

- [ ] **Step 4: Run storage tests**

Run: `pnpm.cmd vitest run packages/storage/tests/automationRunStore.test.ts packages/storage/tests/sqlitePersistence.test.ts`

### Task 3: Daemon Automation Orchestrator

**Files:**
- Create: `apps/daemon/src/automationManager.ts`
- Modify: `apps/daemon/src/httpServer.ts`
- Modify: `apps/daemon/src/taskManager.ts` if cancellation needs exposed task status handling
- Test: `apps/daemon/tests/daemon-api.test.ts`

- [ ] **Step 1: Write failing daemon API tests**

Cover `POST /automation-runs`, polling status, partial provider failure continuing to Codex, all providers failing without Codex, Codex failure preserving packet, and restart-readable run status.

- [ ] **Step 2: Implement automation manager**

Create run output directory, write `input.json`, launch provider tasks asynchronously, wait/poll task records, write `review-packet.md`, launch Codex task through injectable orchestration, write `codex-prompt.md`, `codex-output.md`, `diff.patch`, and `final-report.md`.

- [ ] **Step 3: Add daemon routes**

Add `/automation-runs`, `/automation-runs/:runId`, `/automation-runs/:runId/output`, `/cancel`, `/retry`, and `/rerun-codex` routes.

- [ ] **Step 4: Run daemon tests**

Run: `pnpm.cmd vitest run apps/daemon/tests/daemon-api.test.ts`

### Task 4: Prompt Template HTTP API

**Files:**
- Modify: `apps/daemon/src/httpServer.ts`
- Test: `apps/daemon/tests/daemon-api.test.ts`

- [ ] **Step 1: Write failing API tests**

Cover `GET /prompt-templates`, `POST /prompt-templates`, `PUT /prompt-templates/:templateId`, and `DELETE /prompt-templates/:templateId`.

- [ ] **Step 2: Implement routes using `SqlitePromptTemplateStore`**

Seed default templates on startup when no templates exist.

- [ ] **Step 3: Run focused daemon tests**

Run: `pnpm.cmd vitest run apps/daemon/tests/daemon-api.test.ts -t "prompt"`

### Task 5: GUI IPC Surface

**Files:**
- Modify: `apps/gui/src/main/ipcHandlers.ts`
- Modify: `apps/gui/src/main/preload.cts`
- Modify: `apps/gui/src/renderer/types.ts`
- Test: `apps/gui/tests/gui-ipc.test.ts`

- [ ] **Step 1: Write failing IPC tests**

Cover automation run paths and prompt template paths.

- [ ] **Step 2: Implement handlers and preload bridge**

Add `createAutomationRun`, `listAutomationRuns`, `getAutomationRun`, `readAutomationRunOutput`, `cancelAutomationRun`, `retryAutomationRun`, `rerunCodexEdit`, `listPromptTemplates`, `savePromptTemplate`, and `deletePromptTemplate`.

- [ ] **Step 3: Run GUI IPC tests**

Run: `pnpm.cmd vitest run apps/gui/tests/gui-ipc.test.ts`

### Task 6: GUI Review Workspace, Templates, And Runs

**Files:**
- Modify: `apps/gui/src/renderer/App.tsx`
- Modify: `apps/gui/src/renderer/types.ts`
- Modify: `apps/gui/src/renderer/guiLogic.ts`
- Create: `apps/gui/src/renderer/routes/ReviewWorkspacePage.tsx`
- Create: `apps/gui/src/renderer/routes/TemplatesPage.tsx`
- Create: `apps/gui/src/renderer/routes/RunsPage.tsx`
- Modify: `apps/gui/src/renderer/styles.css`
- Test: `apps/gui/tests/gui-renderer.test.tsx`
- Test: `apps/gui/tests/gui-logic.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Cover default Review Workspace, provider/template selection, start button invoking `createAutomationRun`, Runs status display, template edit save, and error banners.

- [ ] **Step 2: Implement pages**

Build dense operational UI with sidebar entries: Review Workspace, Providers, Prompt Templates, Runs, Settings.

- [ ] **Step 3: Add polling**

Poll automation runs every two seconds, keeping Tasks page available as lower-level diagnostics or replacing it with Runs if tests support it.

- [ ] **Step 4: Run GUI renderer tests**

Run: `pnpm.cmd vitest run apps/gui/tests/gui-renderer.test.tsx apps/gui/tests/gui-logic.test.ts`

### Task 7: End-To-End Mock Acceptance

**Files:**
- Create: `tests/e2e/automation-run-through-daemon.test.ts`
- Modify: `scripts/acceptance-audit.ts`
- Test: `tests/acceptance-audit.test.ts`

- [ ] **Step 1: Write daemon e2e test**

Use fake Claude outputs and fake Codex orchestration to prove a two-provider run reaches `done`, writes packet files, and exposes output through daemon API.

- [ ] **Step 2: Add audit coverage**

Extend acceptance audit to check automation routes, GUI IPC handlers, and spec-linked files exist.

- [ ] **Step 3: Run e2e and audit tests**

Run: `pnpm.cmd vitest run tests/e2e/automation-run-through-daemon.test.ts tests/acceptance-audit.test.ts`

### Task 8: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run typecheck**

Run: `pnpm.cmd typecheck`

- [ ] **Step 2: Run test suite**

Run: `pnpm.cmd test`

- [ ] **Step 3: Run acceptance audit**

Run: `pnpm.cmd acceptance:audit`

- [ ] **Step 4: Inspect git diff**

Run: `git -c safe.directory=D:/CCAgent diff --check`

- [ ] **Step 5: Update final report**

Summarize implemented routes, GUI entry points, verification commands, and any residual limitations.

## Self-Review

- Spec coverage: tasks cover prompt templates, run aggregation, daemon API, GUI IPC, GUI pages, Codex edit, persistence, errors, audit, and tests.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: route, IPC, and store names match the design document and are reused consistently across tasks.
