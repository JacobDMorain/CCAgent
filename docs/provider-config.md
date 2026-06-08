# Provider Configuration

CCAgent supports provider templates that are selected per task. Provider configuration is stored in the daemon; API keys are stored separately through the secret store.

## Built-in provider templates

| Provider | Mode | Default model | Base URL |
|---|---|---|---|
| GLM | OpenAI-compatible | `glm-5.1` | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek | OpenAI-compatible | `deepseek-v4-flash` | `https://api.deepseek.com` |

OpenAI-compatible providers are reached through a task-local Anthropic-to-OpenAI proxy on `127.0.0.1`. Anthropic-compatible providers are passed directly to the Claude child process through Anthropic environment variables.

## Release verification

Verified on 2026-06-05 against official provider documentation:

- GLM `glm-5.1` uses `https://open.bigmodel.cn/api/paas/v4`.
- DeepSeek V4 uses `https://api.deepseek.com`; `deepseek-v4-flash` is the default template model.

Re-verify GLM and DeepSeek base URLs before each release because upstream provider endpoints can change.

## Security notes

API keys are never returned from MCP tools, GUI renderer state, task output, or logs. The GUI only displays a masked fingerprint after a key is saved.

The first Windows build stores API keys in `%APPDATA%/CCAgent/secrets.json` using authenticated local encryption. The file does not contain plaintext keys, and tests verify that saved keys can be reopened across daemon instances without exposing the raw value.

First-version Anthropic-compatible mode passes the provider key to the Claude child process environment as `ANTHROPIC_AUTH_TOKEN`. Logs, task output, and UI surfaces must still redact the key.

OpenAI-compatible mode uses a per-task local proxy and a task-local bearer token. The upstream provider key is held by the daemon/proxy and is not placed in MCP responses.

## Local transport design

The first version uses local HTTP on `127.0.0.1` with bearer auth instead of localhost HTTPS. This keeps setup simple for a local desktop/service product while still avoiding unauthenticated cross-process access. Do not bind daemon or proxy listeners to public interfaces.
