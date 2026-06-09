# Release Checklist

Use this checklist before publishing a CCAgent build.

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm test:coverage` passes.
- [ ] `pnpm build` passes.
- [ ] Playwright GUI smoke passes.
- [ ] `pnpm acceptance:local-runtime` passes and writes local daemon/GUI/dashboard/Claude settings evidence.
- [ ] `pnpm acceptance:codex-mcp` passes after Codex has the ccagent MCP server registered.
- [ ] `pnpm acceptance:real-providers` passes with `GLM_API_KEY` and `DEEPSEEK_API_KEY` set in the local environment.
- [ ] Required local secrets are supplied according to `docs/local-secrets.md` without committing key material.
- [ ] Required `CCAGENT_ALLOWED_ROOTS` and `CCAGENT_EXTERNAL_PROVIDER_CONSENT` entries are present in local config for any external-provider review roots.
- [ ] `pnpm acceptance:audit` reports no missing evidence and all manual gates have been executed in the target environment.
- [ ] Manual provider test passes.
- [x] GLM and DeepSeek template base URLs were verified against current provider docs on 2026-06-05.
- [ ] Codex MCP call returns result.
- [ ] Two-provider concurrency test passes.
- [ ] Port exhaustion behavior is tested.
- [ ] Daemon recovery behavior is tested.
- [ ] Coverage thresholds meet or exceed 80%.
- [ ] API keys are redacted from MCP output, GUI task data, and daemon logs.

## Manual acceptance scenario

1. Start CCAgent daemon.
2. Start CCAgent GUI.
3. Configure GLM provider with API key and model `glm-5.1`.
4. Register CCAgent MCP server in Codex.
5. Call `ccagent.review_file` against `test.md`.
6. Confirm Codex receives review text.
7. Confirm GUI task dashboard shows the completed task.
8. Confirm no global Claude Code settings file was modified.
9. Start another task with DeepSeek while GLM task is running.
10. Confirm both tasks finish independently.
11. Confirm task cancellation kills only the selected task.
12. Confirm daemon startup recovery marks orphaned running tasks as `error`.
13. Confirm max concurrent task limit is enforced.
14. Confirm proxy port exhaustion returns a structured error.
15. Confirm the automated API key redaction e2e test passes for MCP output, GUI task data, and logs.
16. Confirm GLM and DeepSeek template URLs were re-verified against current provider docs before release.

## Acceptance audit

Run `pnpm acceptance:audit` after the normal build/test/smoke commands. It writes `dist/acceptance/acceptance-audit.json` and `.md`, separating items with automated evidence from items that still require real Codex, GUI, GLM, and DeepSeek confirmation. A non-zero exit means the release is not fully accepted yet.

Run `pnpm acceptance:local-runtime` to prove the built daemon starts, the GUI smoke opens, the GUI task dashboard can display a completed daemon task, and the global Claude Code settings file stays unchanged. It writes `dist/acceptance/local-runtime-acceptance.json` and updates `dist/acceptance/manual-evidence.json` for those local runtime gates.

Run `pnpm acceptance:codex-mcp` after registering the MCP server in Codex. It verifies the local Codex config contains a `ccagent` MCP block pointing at the built MCP server entrypoint and writes token-free evidence to `dist/acceptance/codex-mcp-acceptance.json` and `manual-evidence.json`.

Use `docs/local-secrets.md` for the operator-supplied `GLM_API_KEY`, `DEEPSEEK_API_KEY`, and optional provider URL overrides. For daily runtime use, keep them in `ccagent.local-config.md`; `pnpm codex:mcp:register` wires that file into Codex with `CCAGENT_LOCAL_CONFIG_PATH` without copying key values into Codex config.

For review tasks that send workspace files to external providers, put the required roots in `CCAGENT_ALLOWED_ROOTS` and document provider/root approval in `CCAGENT_EXTERNAL_PROVIDER_CONSENT`. These entries are local operator policy, are synced by the daemon, and should be included in manual acceptance notes without exposing API keys.

If provider credentials are available, run `pnpm acceptance:real-providers` first with `GLM_API_KEY` and `DEEPSEEK_API_KEY` set. It starts a local daemon, registers the built-in GLM and DeepSeek providers, calls the MCP `ccagent.review_file` path for GLM, and writes redacted evidence to `dist/acceptance/real-provider-acceptance.json`. It also updates `dist/acceptance/manual-evidence.json` for the provider-backed gates it can prove.

After the real manual scenario is executed, copy `docs/manual-evidence.example.json` to `dist/acceptance/manual-evidence.json` and replace the example notes with evidence from the local run. Do not paste API keys, bearer tokens, or raw authorization headers into that file. `pnpm acceptance:audit` rejects secret-like evidence strings.
