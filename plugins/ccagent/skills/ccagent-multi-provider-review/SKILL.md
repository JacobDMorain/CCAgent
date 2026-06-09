---
name: ccagent-multi-provider-review
description: Use when the user asks to review a local file or document with CCAgent, multiple providers, GLM, DeepSeek, Claude Code CLI, or wants batch review status or output from CCAgent.
---

# CCAgent Multi Provider Review

Use the CCAgent MCP tools when the user asks for a local file review through CCAgent, especially with multiple providers or reviewer agents.

## Preconditions

- Prefer MCP tools over shell commands.
- If provider availability is unknown, call `ccagent.list_providers` first.
- The daemon should already be running at `http://127.0.0.1:47621`. If a tool reports daemon unavailable, tell the user to start or restart the daemon.
- Do not ask the user to paste provider API keys. CCAgent reads local operator config and secrets.

## Single File, Multiple Providers

Call `ccagent.review_file_multi` with:

```json
{
  "cwd": "D:/CodeAnalyze",
  "file": "example.md",
  "reviewStyle": "full",
  "language": "zh-CN",
  "reviewers": [
    { "provider": "glm", "model": "glm-5.1" },
    { "provider": "deepseek", "model": "deepseek-v4-flash" }
  ],
  "timeoutMs": 600000,
  "maxOutputBytes": 131072
}
```

Use the user's actual `cwd` and `file`. If they provide an absolute file path, split it into parent directory as `cwd` and filename or relative path as `file`.

## Poll And Read

After `review_file_multi` returns a `batchId`:

1. Call `ccagent.get_review_batch_status` with `{ "batchId": "..." }`.
2. If status is `running`, wait briefly and poll again when the user asks for progress.
3. When terminal, call `ccagent.read_review_batch_output` with `{ "batchId": "...", "maxBytes": 131072 }`.
4. Summarize results by provider and preserve disagreements.

## Defaults

- Use `reviewStyle: "full"` unless the user asks for bugs, architecture, or language-only review.
- Use `language: "zh-CN"` for Chinese user requests unless they ask otherwise.
- Use all enabled review-capable providers unless the user names specific providers.
- Do not hide failed providers; report successes and failures separately.

## Safety

Never claim CCAgent bypasses Codex host safety. If a path is denied, explain that the daemon allowed roots or operator consent must be configured locally.
