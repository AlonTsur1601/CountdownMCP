import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PlanType, RawRateLimitsResponse, RawRateLimitWindow } from "./types.js";

// Claude Code has no public CLI command or app-server RPC for rate-limit data
// (tracked upstream: anthropics/claude-code#44328, #32796). This mirrors the
// approach used by community tools such as ccusage: read the OAuth access
// token Claude Code already stores locally after `claude login`, and call the
// same undocumented endpoint the `/status` slash command uses. This is
// read-only and never writes back to the credentials file.
const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const FIVE_HOUR_WINDOW_MINUTES = 300;
const WEEKLY_WINDOW_MINUTES = 10_080;

interface ClaudeOAuthCredentials {
  claudeAiOauth?: {
    accessToken?: string;
    expiresAt?: number;
    subscriptionType?: string;
  };
}

interface ClaudeUsageLimit {
  utilization?: number | null;
  resets_at?: string | null;
}

interface ClaudeOAuthUsageResponse {
  five_hour?: ClaudeUsageLimit | null;
  seven_day?: ClaudeUsageLimit | null;
  seven_day_sonnet?: ClaudeUsageLimit | null;
  seven_day_opus?: ClaudeUsageLimit | null;
}

function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

function isoToEpochSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function toWindow(limit: ClaudeUsageLimit | null | undefined, durationMinutes: number): RawRateLimitWindow | null {
  if (!limit || typeof limit.utilization !== "number") return null;
  return {
    usedPercent: limit.utilization,
    windowDurationMins: durationMinutes,
    resetsAt: isoToEpochSeconds(limit.resets_at),
  };
}

async function readAccessToken(): Promise<{ token: string; subscriptionType: string | null }> {
  const path = join(claudeConfigDir(), ".credentials.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`No Claude Code credentials found at ${path}. Run "claude login" once, then retry.`);
  }
  let parsed: ClaudeOAuthCredentials;
  try {
    parsed = JSON.parse(raw) as ClaudeOAuthCredentials;
  } catch {
    throw new Error(`Claude Code credentials at ${path} could not be parsed.`);
  }
  const oauth = parsed.claudeAiOauth;
  if (!oauth?.accessToken) {
    throw new Error(`Claude Code credentials at ${path} do not contain an access token.`);
  }
  if (typeof oauth.expiresAt === "number" && oauth.expiresAt < Date.now()) {
    throw new Error("The Claude Code access token has expired. Open Claude Code once so it refreshes, then retry.");
  }
  return { token: oauth.accessToken, subscriptionType: oauth.subscriptionType ?? null };
}

export async function readClaudeOAuthUsage(
  nowMs = Date.now(),
): Promise<{ raw: RawRateLimitsResponse; timestamp: string }> {
  const { token, subscriptionType } = await readAccessToken();

  let response: Response;
  try {
    response = await fetch(USAGE_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": OAUTH_BETA_HEADER,
      },
    });
  } catch (error) {
    throw new Error(`Could not reach the Claude usage endpoint: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Claude usage endpoint returned ${response.status} ${response.statusText}.`);
  }

  let body: ClaudeOAuthUsageResponse;
  try {
    body = await response.json() as ClaudeOAuthUsageResponse;
  } catch {
    throw new Error("Claude usage endpoint returned a response that could not be parsed as JSON.");
  }

  const primary = toWindow(body.five_hour, FIVE_HOUR_WINDOW_MINUTES);
  const secondary = toWindow(body.seven_day, WEEKLY_WINDOW_MINUTES);
  if (!primary && !secondary) {
    throw new Error("Claude usage endpoint returned no readable rate-limit windows.");
  }

  const rateLimitsByLimitId: RawRateLimitsResponse["rateLimitsByLimitId"] = {
    claude: {
      limitId: "claude",
      limitName: "Claude Code",
      planType: subscriptionType as PlanType | null,
      primary,
      secondary,
    },
  };
  const sonnet = toWindow(body.seven_day_sonnet, WEEKLY_WINDOW_MINUTES);
  if (sonnet) {
    rateLimitsByLimitId.claude_weekly_sonnet = {
      limitId: "claude_weekly_sonnet",
      limitName: "Weekly (Sonnet)",
      secondary: sonnet,
    };
  }
  const opus = toWindow(body.seven_day_opus, WEEKLY_WINDOW_MINUTES);
  if (opus) {
    rateLimitsByLimitId.claude_weekly_opus = {
      limitId: "claude_weekly_opus",
      limitName: "Weekly (Opus)",
      secondary: opus,
    };
  }

  return {
    raw: { rateLimits: rateLimitsByLimitId.claude, rateLimitsByLimitId },
    timestamp: new Date(nowMs).toISOString(),
  };
}
