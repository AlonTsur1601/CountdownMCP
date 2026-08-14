import type { UsageSnapshot } from "../src/types.js";

export function usageFixture(usedPercent: number, overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  const remainingPercent = 100 - usedPercent;
  return {
    planType: "plus",
    usedPercent,
    remainingPercent,
    effectiveLimitId: "codex",
    buckets: {
      codex: {
        limitId: "codex",
        limitName: null,
        planType: "plus",
        primary: {
          usedPercent,
          remainingPercent,
          durationMinutes: 10_080,
          resetsAt: 2_000_000_000,
          resetsAtIso: "2033-05-18T03:33:20.000Z",
          secondsUntilReset: 100,
        },
        secondary: null,
        effectiveWindow: "primary",
        usedPercent,
        remainingPercent,
        credits: null,
        individualLimit: null,
        spendControlReached: false,
        rateLimitReachedType: null,
      },
    },
    credits: null,
    spendControlReached: false,
    rateLimitReachedType: null,
    resetCreditsAvailable: 0,
    source: "app_server",
    sampledAt: "2026-08-14T00:00:00.000Z",
    sourceTimestamp: null,
    stale: false,
    ...overrides,
  };
}
