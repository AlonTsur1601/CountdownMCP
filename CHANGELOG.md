# Changelog

## 0.1.0 - Unreleased

- Installer also registers CountdownMCP with Claude Code when its CLI is detected, in addition to Codex.
- countdown_get_usage now reads live usage under Claude Code too, via Claude Code's own locally stored OAuth token, with Codex behavior unchanged.
- Initial local read-only STDIO MCP server.
- Live Codex rate-limit retrieval with a constrained local fallback.
- Plan-aware usage reporting and WorkCandidate v1 execution advice.
- Cross-platform installer, tests, and GitHub Actions workflow.
