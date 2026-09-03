import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readClaudeOAuthUsage } from "../src/claude-usage-client.js";

describe("readClaudeOAuthUsage", () => {
  let configDir: string;
  let previousConfigDir: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any = null;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "countdown-claude-test-"));
    previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    fetchSpy?.mockRestore();
    await rm(configDir, { recursive: true, force: true });
  });

  it("throws a clear error when no credentials file exists", async () => {
    await expect(readClaudeOAuthUsage()).rejects.toThrow(/No Claude Code credentials found/);
  });

  it("throws when the stored access token has expired", async () => {
    await writeFile(
      join(configDir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-x", expiresAt: Date.now() - 1_000 } }),
      "utf8",
    );
    await expect(readClaudeOAuthUsage()).rejects.toThrow(/expired/);
  });

  it("normalizes a live usage response into rate-limit windows", async () => {
    await writeFile(
      join(configDir, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-x",
          expiresAt: Date.now() + 60 * 60 * 1_000,
          subscriptionType: "max_5x",
        },
      }),
      "utf8",
    );
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        five_hour: { utilization: 35, resets_at: "2026-02-06T22:00:00+00:00" },
        seven_day: { utilization: 14, resets_at: "2026-02-12T20:00:00+00:00" },
        seven_day_sonnet: { utilization: 39, resets_at: "2026-02-09T14:00:00+00:00" },
        seven_day_opus: null,
      }),
    } as Response);

    const result = await readClaudeOAuthUsage(1_770_000_000_000);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.anthropic.com/api/oauth/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-ant-oat01-x",
          "anthropic-beta": "oauth-2025-04-20",
        }),
      }),
    );
    expect(result.raw.rateLimits.limitId).toBe("claude");
    expect(result.raw.rateLimits.primary?.usedPercent).toBe(35);
    expect(result.raw.rateLimits.secondary?.usedPercent).toBe(14);
    expect(result.raw.rateLimitsByLimitId?.claude_weekly_sonnet?.secondary?.usedPercent).toBe(39);
    expect(result.raw.rateLimitsByLimitId?.claude_weekly_opus).toBeUndefined();
  });

  it("throws when the endpoint responds with an error status", async () => {
    await writeFile(
      join(configDir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-x", expiresAt: Date.now() + 60_000 } }),
      "utf8",
    );
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
    } as Response);

    await expect(readClaudeOAuthUsage()).rejects.toThrow(/401/);
  });
});
