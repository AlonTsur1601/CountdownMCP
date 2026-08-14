export type PlanType =
  | "free"
  | "go"
  | "plus"
  | "pro"
  | "prolite"
  | "team"
  | "self_serve_business_usage_based"
  | "business"
  | "ent26"
  | "enterprise_cbp_usage_based"
  | "enterprise"
  | "edu"
  | "unknown";

export interface RawRateLimitWindow {
  usedPercent?: number;
  used_percent?: number;
  windowDurationMins?: number | null;
  window_minutes?: number | null;
  resetsAt?: number | null;
  resets_at?: number | null;
}

export interface RawCreditsSnapshot {
  hasCredits?: boolean;
  has_credits?: boolean;
  unlimited?: boolean;
  balance?: string | null;
}

export interface RawRateLimitSnapshot {
  limitId?: string | null;
  limit_id?: string | null;
  limitName?: string | null;
  limit_name?: string | null;
  primary?: RawRateLimitWindow | null;
  secondary?: RawRateLimitWindow | null;
  credits?: RawCreditsSnapshot | null;
  individualLimit?: unknown;
  individual_limit?: unknown;
  spendControlReached?: boolean | null;
  spend_control_reached?: boolean | null;
  planType?: PlanType | null;
  plan_type?: PlanType | null;
  rateLimitReachedType?: string | null;
  rate_limit_reached_type?: string | null;
}

export interface RawRateLimitsResponse {
  rateLimits: RawRateLimitSnapshot;
  rateLimitsByLimitId?: Record<string, RawRateLimitSnapshot> | null;
  rateLimitResetCredits?: {
    availableCount: number;
    credits?: unknown[] | null;
  } | null;
}

export interface UsageWindow {
  usedPercent: number;
  remainingPercent: number;
  durationMinutes: number | null;
  resetsAt: number | null;
  resetsAtIso: string | null;
  secondsUntilReset: number | null;
}

export interface UsageBucket {
  limitId: string;
  limitName: string | null;
  planType: PlanType;
  primary: UsageWindow | null;
  secondary: UsageWindow | null;
  effectiveWindow: "primary" | "secondary" | null;
  usedPercent: number;
  remainingPercent: number;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
  individualLimit: unknown;
  spendControlReached: boolean | null;
  rateLimitReachedType: string | null;
}

export interface UsageSnapshot {
  planType: PlanType;
  usedPercent: number;
  remainingPercent: number;
  effectiveLimitId: string;
  buckets: Record<string, UsageBucket>;
  credits: UsageBucket["credits"];
  spendControlReached: boolean | null;
  rateLimitReachedType: string | null;
  resetCreditsAvailable: number | null;
  source: "app_server" | "session_fallback";
  sampledAt: string;
  sourceTimestamp: string | null;
  stale: boolean;
}

export interface WorkTask {
  id: string;
  title: string;
  priority: number;
  estimatedMinutes: number;
  dependenciesReady: boolean;
  needsUserInput: boolean;
  canContinueWithoutNewMessage: boolean;
  checkpointable: boolean;
}

export type UsageBand = "normal" | "guarded" | "critical" | "exhausted";

export interface WorkRecommendation {
  task: WorkTask;
  score: number;
  reason: string;
}

export interface WorkAdvice {
  band: UsageBand;
  primaryRecommendation: WorkRecommendation | null;
  recommendedNow: WorkRecommendation[];
  deferUntilReset: Array<{ task: WorkTask; reason: string }>;
  checkpoint: string;
  usage: UsageSnapshot;
}
