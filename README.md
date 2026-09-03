# CountdownMCP

[![CI](https://github.com/AlonTsur1601/CountdownMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/AlonTsur1601/CountdownMCP/actions/workflows/ci.yml)
[![M8ven Score](https://m8ven.ai/badge/mcp/alontsur1601-countdownmcp-1vb57l)](https://m8ven.ai/mcp/alontsur1601-countdownmcp-1vb57l)

CountdownMCP is a local, read-only MCP server that gives Codex and Claude Code a plan-aware view of its remaining usage and helps it choose work that fits the current usage window.

It reports a percentage in the context of the actual plan (`plus`, `pro`, and other Codex plan types). It does not invent a token allowance or pretend that the same percentage means the same capacity across plans.

CountdownMCP complements [TodoMCP](https://github.com/AlonTsur1601/TodoMCP), but both servers remain fully independent and useful on their own.

Codex should skip CountdownMCP for small, self-contained, low-risk tasks that can reasonably finish in one short turn. It should check usage once before work expected to take more than 10 minutes, require at least three meaningful execution steps, involve repeated implementation-and-test cycles, or be explicitly described as continuing across multiple substantial prompts.

## What it does

- Reads live ChatGPT/Codex rate-limit data through the local Codex app-server.
- Under Claude Code, reads live usage from the same endpoint the `/status` command uses, via the OAuth token Claude Code already stores locally after `claude login`. This mirrors the approach used by community tools such as `ccusage`, since Claude Code has no public CLI command or app-server RPC for this yet (tracked upstream: anthropics/claude-code#44328, #32796). The token is only read, never written back.
- Reports plan, used and remaining percentages, all returned windows, reset time, credits, and limit state.
- Compares the five-hour and weekly windows by estimated remaining capacity rather than treating equal percentages as equal quota. Based on measurements after the August 2026 restoration of the Plus five-hour limit, a full five-hour allowance is estimated as 16% of the weekly allowance (about 6.25 full five-hour allowances per week).
- Falls back to the latest local Codex rate-limit metadata when app-server access is unavailable. Fallback results are explicitly marked with their source and staleness. There is no equivalent local fallback for Claude Code yet, since Claude Code does not write a comparable local rate-limit snapshot.
- Advises which ready tasks to run in normal, guarded, critical, and exhausted usage states.
- Keeps an active, continuation-safe task eligible even at 0% remaining, because an already-running Codex turn can often continue without a new user message.
- Uses STDIO only: no port, HTTP server, account token, or direct modification of another MCP server.

## Requirements

- Node.js 18 or newer
- For Codex: the Codex CLI available as `codex` and signed in to ChatGPT
- For Claude Code: signed in once via `claude login` (or the desktop app), so `~/.claude/.credentials.json` holds a valid access token

## Install

Clone the repository and run the installer:

```powershell
git clone https://github.com/AlonTsur1601/CountdownMCP.git
Set-Location CountdownMCP
node install.mjs
```

The installer builds and tests the project first. It then installs a stable runtime under `CODEX_HOME/mcp/countdown-mcp` (normally `~/.codex/mcp/countdown-mcp`) and updates only the `countdown_mcp` entry through the Codex CLI. Restart Codex after installation.

The installer preserves every other MCP entry. If replacing the CountdownMCP entry fails, it restores the prior Codex configuration and prior installed CountdownMCP runtime.

An installed copy is a local snapshot. New Git commits and GitHub Releases do not update it automatically. To update an existing clone, pull the newer source and rerun the installer:

```powershell
Set-Location CountdownMCP
git pull --ff-only
node install.mjs
```

Restart Codex after installing or updating.

## Tools

### `countdown_get_usage`

No input. Returns structured data similar to:

```json
{
  "planType": "plus",
  "usedPercent": 31,
  "remainingPercent": 69,
  "effectiveLimitId": "codex",
  "source": "app_server",
  "stale": false
}
```

Credits are reported separately from the plan percentage. `source` is `app_server` or `session_fallback` for Codex, and `claude_oauth` for Claude Code.

### `countdown_advise_work`

Accepts the TodoMCP WorkCandidate v1 contract. Unknown fields are ignored for forward compatibility:

```json
{
  "currentTaskId": "task-1",
  "tasks": [
    {
      "id": "task-1",
      "title": "Run integration tests",
      "priority": 5,
      "estimatedMinutes": 20,
      "dependenciesReady": true,
      "needsUserInput": false,
      "canContinueWithoutNewMessage": true,
      "checkpointable": true
    }
  ]
}
```

The output itself is compatible with TodoMCP's advice input:

```json
{
  "recommendedNow": ["task-1"],
  "deferUntilReset": [],
  "executionOrder": ["task-1"],
  "checkpoint": "Create a small verified checkpoint after the first recommended task.",
  "source": "countdown-mcp"
}
```

CountdownMCP does not store a queue, read TodoMCP files, import TodoMCP code, or bypass TodoMCP dependency and completion gates.

Either server continues to work normally when the other is absent.

## Development

```powershell
npm ci
npm run check
npm run smoke
```

`npm run smoke` uses the signed-in local Codex account and prints only the plan type and remaining percentage.

## Data and security

- The Codex live path asks Codex app-server only for `account/rateLimits/read`.
- The Codex fallback parser returns only the `rate_limits` object and its timestamp. It never returns conversation text, authentication data, or token-usage details.
- The Claude Code path only reads the OAuth access token already stored by Claude Code and calls Anthropic's usage endpoint with it read-only; it never writes to the credentials file and never refreshes or rotates the token itself.
- Both tools are advertised as read-only, non-destructive, closed-world, and idempotent.
- Runtime diagnostics go to stderr; stdout is reserved for MCP protocol messages.

## Releases

Pushing a tag that exactly matches the version in `package.json` (for example, `v0.1.0`) runs the release workflow. It repeats the full check and publishes a GitHub Release containing a source ZIP and SHA-256 checksum. Users extract the ZIP and run `node install.mjs`; no global npm publication is required.

## License

[MIT License](LICENSE)
