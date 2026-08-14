# Contributing

1. Open an issue for behavioral or schema changes before implementing them.
2. Keep tools focused, read-only, and independent from other MCP servers.
3. Preserve backward compatibility for public tool and `WorkCandidate.v1` fields.
4. Run `npm run check` before submitting a pull request.
5. Include tests for invalid input, stale data, and failure behavior, not only happy paths.

Do not include credentials, Codex session content, authentication data, or private rate-limit metadata in issues or fixtures.
