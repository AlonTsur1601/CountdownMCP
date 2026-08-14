# CountdownMCP

CountdownMCP is a local, read-only MCP server that gives Codex a plan-aware view of its remaining usage and helps it choose work that fits the current usage window.

It reports a percentage in the context of the actual plan (`plus`, `pro`, and other Codex plan types). It does **not** invent a token allowance or pretend that the same percentage means the same capacity across plans.

## Features

- Reads live ChatGPT/Codex rate-limit data through the local Codex app-server.
- Reports plan, used and remaining percentages, all returned windows, reset time, credits, and limit state.
- Falls back to the latest local rate-limit metadata when app-server access is unavailable. Fallback results are explicitly marked with their source and staleness.
- Advises which ready tasks to run in normal, guarded, critical, and exhausted usage states.
- Keeps an active, continuation-safe task eligible even at 0% remaining, because an already-running Codex turn can often continue without a new user message.
- Uses STDIO only: no port, HTTP server, account token, or direct modification of another MCP server.

## Requirements

- Node.js 18 or newer.
- Codex CLI available as `codex` and signed in to ChatGPT.

## Install

Clone or extract this repository, then run:

```bash
node install.mjs
```

The installer builds and tests the project first. It then installs a stable runtime under `CODEX_HOME/mcp/countdown-mcp` (normally `~/.codex/mcp/countdown-mcp`) and updates only the `countdown_mcp` entry through the Codex CLI. Restart Codex after installation.

The installer preserves every other MCP entry. If replacing the CountdownMCP entry fails, it restores the prior Codex configuration and prior installed CountdownMCP runtime.

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

Credits are reported separately from the plan percentage.

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

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run smoke
```

`npm run smoke` uses the signed-in local Codex account and prints only the plan type and remaining percentage.

## Privacy and safety

- The live path asks Codex app-server only for `account/rateLimits/read`.
- The fallback parser returns only the `rate_limits` object and its timestamp. It never returns conversation text, authentication data, or token-usage details.
- Both tools are advertised as read-only, non-destructive, closed-world, and idempotent.
- Runtime diagnostics go to stderr; stdout is reserved for MCP protocol messages.

## License

MIT
