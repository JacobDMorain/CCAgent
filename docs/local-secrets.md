# Local Secrets Setup

Use this document as the local checklist for values that must be supplied by the operator. Do not commit real API keys, bearer tokens, or provider credentials to the repository.

## Required Values

| Name | Required for | Notes |
|---|---|---|
| `GLM_API_KEY` | Runtime provider sync and `pnpm acceptance:real-providers` | GLM provider acceptance with model `glm-5.1`. |
| `DEEPSEEK_API_KEY` | Runtime provider sync and `pnpm acceptance:real-providers` | DeepSeek provider acceptance with model `deepseek-v4-flash`. |
| `GLM_BASE_URL` | Runtime provider sync and acceptance | Optional override when GLM is reached through an operator gateway such as ByteDance Volcano. |
| `DEEPSEEK_BASE_URL` | Runtime provider sync and acceptance | Optional override when DeepSeek is reached through a non-default gateway. |
| `CCAGENT_ALLOWED_ROOTS` | Runtime workspace policy sync | Optional semicolon-separated roots that CCAgent may read for review tasks. |
| `CCAGENT_EXTERNAL_PROVIDER_CONSENT` | Runtime audit and operator intent | Optional semicolon-separated `provider:root` entries documenting which roots may be sent to which external providers. |

`CCAGENT_DAEMON_TOKEN` is normally not required in local Codex MCP config. When Codex, daemon, and MCP server run under the same Windows account, the MCP server reads the daemon token from the local CCAgent secret store.

## Recommended: `ccagent.local-config.md`

For daily Codex MCP use, fill `ccagent.local-config.md` in the repository root. `pnpm.cmd codex:mcp:register` writes `CCAGENT_LOCAL_CONFIG_PATH` into the Codex MCP server config, and the daemon syncs provider templates, URL overrides, API keys, allowed workspace roots, and operator egress consent from this file at startup or MCP startup.

```dotenv
GLM_API_KEY=
DEEPSEEK_API_KEY=
GLM_BASE_URL=
DEEPSEEK_BASE_URL=
CCAGENT_ALLOWED_ROOTS=D:/CodeAnalyze;D:/AnotherProject
CCAGENT_EXTERNAL_PROVIDER_CONSENT=glm:D:/CodeAnalyze;deepseek:D:/AnotherProject
```

Leave optional URL overrides blank when the built-in provider URL is correct. `CCAGENT_ALLOWED_ROOTS` controls CCAgent daemon path policy. `CCAGENT_EXTERNAL_PROVIDER_CONSENT` is an auditable local declaration that the named provider may receive content from the named root; it does not bypass Codex host safety prompts or third-party data handling rules. Do not commit this file.

## Alternative: Current PowerShell Session

Set keys only in the current terminal session:

```powershell
$env:GLM_API_KEY = "<paste GLM key here>"
$env:DEEPSEEK_API_KEY = "<paste DeepSeek key here>"
```

Then run:

```powershell
pnpm.cmd acceptance:real-providers
pnpm.cmd acceptance:audit
```

Close the terminal after acceptance if you do not want the variables to remain in the session.

## Optional: Private `.env.local`

If you prefer a local file, create `.env.local` in the repository root. Keep it private and do not commit it.

```dotenv
GLM_API_KEY=
DEEPSEEK_API_KEY=
```

Load it in PowerShell before running acceptance:

```powershell
Get-Content .env.local | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+?)\s*=\s*(.*)\s*$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
```

Then run:

```powershell
pnpm.cmd acceptance:real-providers
pnpm.cmd acceptance:audit
```

## Safety Rules

- Do not paste real API keys into `docs/`, `dist/acceptance/manual-evidence.json`, chat messages, issue comments, or screenshots.
- `pnpm acceptance:real-providers` writes a redacted report and should not store raw keys.
- `pnpm acceptance:audit` rejects manual evidence that looks like an API key or bearer token.
- Treat every `CCAGENT_EXTERNAL_PROVIDER_CONSENT` entry as approval to send matching local file contents to that external provider during tasks.
- If a key is accidentally committed or shared, revoke it in the provider console and create a new one.
