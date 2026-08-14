import { describe, expect, it } from "vitest";
import { normalizeUsage } from "../src/normalize.js";
import type { PlanType, RawRateLimitsResponse } from "../src/types.js";

describe("normalizeUsage", () => {
  it.each<PlanType>([
    "free", "go", "plus", "pro", "prolite", "team",
    "self_serve_business_usage_based", "business", "ent26",
    "enterprise_cbp_usage_based", "enterprise", "edu", "unknown",
  ])("preserves the known plan %s", (planType) => {
    const result = normalizeUsage({
      rateLimits: { limitId: "codex", planType, primary: { usedPercent: 30 } },
    }, { source: "app_server", nowMs: 1_000 });
    expect(result.planType).toBe(planType);
    expect(result.remainingPercent).toBe(70);
  });

  it("uses the most restrictive window and keeps credits separate", () => {
    const raw: RawRateLimitsResponse = {
      rateLimits: {
        limitId: "codex",
        planType: "plus",
        primary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: 2_000 },
        secondary: { usedPercent: 85, windowDurationMins: 300, resetsAt: 1_500 },
        credits: { hasCredits: true, unlimited: false, balance: "12.5" },
        spendControlReached: false,
      },
      rateLimitResetCredits: { availableCount: 2, credits: [] },
    };
    const result = normalizeUsage(raw, { source: "app_server", nowMs: 1_000_000 });
    expect(result.usedPercent).toBe(85);
    expect(result.remainingPercent).toBe(15);
    expect(result.buckets.codex.effectiveWindow).toBe("secondary");
    expect(result.credits?.balance).toBe("12.5");
    expect(result.resetCreditsAvailable).toBe(2);
  });

  it("normalizes snake_case fallback data and absent reset times", () => {
    const result = normalizeUsage({
      rateLimits: {
        limit_id: "codex",
        plan_type: "plus",
        primary: { used_percent: 3, window_minutes: 10_080, resets_at: null },
        spend_control_reached: null,
      },
    }, { source: "session_fallback", stale: true, sourceTimestamp: "2026-01-01T00:00:00Z" });
    expect(result.remainingPercent).toBe(97);
    expect(result.buckets.codex.primary?.resetsAtIso).toBeNull();
    expect(result.stale).toBe(true);
  });
});
