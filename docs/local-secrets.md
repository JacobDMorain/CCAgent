# Local Secrets Setup

Use this document as the local checklist for values that must be supplied by the operator. Do not commit real API keys, bearer tokens, or provider credentials to the repository.

## Required Values

| Name | Required for | Notes |
|---|---|---|
| `GLM_API_KEY` | `pnpm acceptance:real-providers` | GLM provider acceptance with model `glm-5.1`. |
| `DEEPSEEK_API_KEY` | `pnpm acceptance:real-providers` | DeepSeek provider acceptance with model `deepseek-v4-flash`. |

`CCAGENT_DAEMON_TOKEN` is normally not required in local Codex MCP config. When Codex, daemon, and MCP server run under the same Windows account, the MCP server reads the daemon token from the local CCAgent secret store.

## Recommended: Current PowerShell Session

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
- If a key is accidentally committed or shared, revoke it in the provider console and create a new one.
