import type {
  PlanType,
  RawRateLimitSnapshot,
  RawRateLimitWindow,
  RawRateLimitsResponse,
  UsageBucket,
  UsageSnapshot,
  UsageWindow,
} from "./types.js";

const KNOWN_PLANS = new Set<PlanType>([
  "free", "go", "plus", "pro", "prolite", "team",
  "self_serve_business_usage_based", "business", "ent26",
  "enterprise_cbp_usage_based", "enterprise", "edu", "unknown",
]);

function clampPercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizePlan(value: unknown): PlanType {
  return typeof value === "string" && KNOWN_PLANS.has(value as PlanType)
    ? value as PlanType
    : "unknown";
}

function normalizeWindow(raw: RawRateLimitWindow | null | undefined, nowMs: number): UsageWindow | null {
  if (!raw) return null;
  const usedPercent = clampPercent(raw.usedPercent ?? raw.used_percent);
  const resetsAt = raw.resetsAt ?? raw.resets_at ?? null;
  const durationMinutes = raw.windowDurationMins ?? raw.window_minutes ?? null;
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    durationMinutes: typeof durationMinutes === "number" ? durationMinutes : null,
    resetsAt: typeof resetsAt === "number" ? resetsAt : null,
    resetsAtIso: typeof resetsAt === "number" ? new Date(resetsAt * 1000).toISOString() : null,
    secondsUntilReset: typeof resetsAt === "number"
      ? Math.max(0, Math.ceil((resetsAt * 1000 - nowMs) / 1000))
      : null,
  };
}

function normalizeBucket(raw: RawRateLimitSnapshot, fallbackId: string, nowMs: number): UsageBucket {
  const primary = normalizeWindow(raw.primary, nowMs);
  const secondary = normalizeWindow(raw.secondary, nowMs);
  const effectiveWindow = primary && secondary
    ? (primary.usedPercent >= secondary.usedPercent ? "primary" : "secondary")
    : primary ? "primary" : secondary ? "secondary" : null;
  const effective = effectiveWindow === "primary" ? primary : effectiveWindow === "secondary" ? secondary : null;
  const rawCredits = raw.credits;
  return {
    limitId: raw.limitId ?? raw.limit_id ?? fallbackId,
    limitName: raw.limitName ?? raw.limit_name ?? null,
    planType: normalizePlan(raw.planType ?? raw.plan_type),
    primary,
    secondary,
    effectiveWindow,
    usedPercent: effective?.usedPercent ?? 0,
    remainingPercent: effective?.remainingPercent ?? 100,
    credits: rawCredits ? {
      hasCredits: rawCredits.hasCredits ?? rawCredits.has_credits ?? false,
      unlimited: rawCredits.unlimited ?? false,
      balance: rawCredits.balance ?? null,
    } : null,
    individualLimit: raw.individualLimit ?? raw.individual_limit ?? null,
    spendControlReached: raw.spendControlReached ?? raw.spend_control_reached ?? null,
    rateLimitReachedType: raw.rateLimitReachedType ?? raw.rate_limit_reached_type ?? null,
  };
}

export function normalizeUsage(
  raw: RawRateLimitsResponse,
  options: {
    source: UsageSnapshot["source"];
    nowMs?: number;
    sourceTimestamp?: string | null;
    stale?: boolean;
  },
): UsageSnapshot {
  const nowMs = options.nowMs ?? Date.now();
  const rawBuckets = raw.rateLimitsByLimitId && Object.keys(raw.rateLimitsByLimitId).length > 0
    ? raw.rateLimitsByLimitId
    : { [raw.rateLimits.limitId ?? raw.rateLimits.limit_id ?? "codex"]: raw.rateLimits };
  const buckets = Object.fromEntries(
    Object.entries(rawBuckets).map(([id, bucket]) => [id, normalizeBucket(bucket, id, nowMs)]),
  );
  const effectiveLimitId = buckets.codex ? "codex" : Object.keys(buckets)[0] ?? "codex";
  if (!buckets[effectiveLimitId]) {
    buckets[effectiveLimitId] = normalizeBucket(raw.rateLimits, effectiveLimitId, nowMs);
  }
  const effective = buckets[effectiveLimitId];
  return {
    planType: effective.planType,
    usedPercent: effective.usedPercent,
    remainingPercent: effective.remainingPercent,
    effectiveLimitId,
    buckets,
    credits: effective.credits,
    spendControlReached: effective.spendControlReached,
    rateLimitReachedType: effective.rateLimitReachedType,
    resetCreditsAvailable: raw.rateLimitResetCredits?.availableCount ?? null,
    source: options.source,
    sampledAt: new Date(nowMs).toISOString(),
    sourceTimestamp: options.sourceTimestamp ?? null,
    stale: options.stale ?? false,
  };
}
