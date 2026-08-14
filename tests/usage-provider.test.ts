import { describe, expect, it } from "vitest";
import { UsageProvider } from "../src/usage-provider.js";
import type { RawRateLimitsResponse } from "../src/types.js";

describe("UsageProvider", () => {
  it("coalesces concurrent cache misses into one app-server request", async () => {
    let calls = 0;
    let nowMs = 1_000;
    const raw: RawRateLimitsResponse = {
      rateLimits: {
        limitId: "codex",
        planType: "plus",
        primary: { usedPercent: 25 },
      },
    };
    const client = {
      async getRateLimits(): Promise<RawRateLimitsResponse> {
        calls++;
        await Promise.resolve();
        return raw;
      },
      async restart(): Promise<void> {},
      close(): void {},
    };
    const provider = new UsageProvider(client, 30_000, () => nowMs++);

    const results = await Promise.all(Array.from({ length: 20 }, () => provider.getUsage()));

    expect(calls).toBe(1);
    expect(new Set(results.map((result) => result.sampledAt)).size).toBe(1);
    expect(results.every((result) => result.remainingPercent === 75)).toBe(true);

    await provider.getUsage(true);
    expect(calls).toBe(2);
  });
});
