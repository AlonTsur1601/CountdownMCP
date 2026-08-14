import { AppServerClient } from "./app-server-client.js";
import { normalizeUsage } from "./normalize.js";
import { readSessionFallback } from "./session-fallback.js";
import type { RawRateLimitsResponse, UsageSnapshot } from "./types.js";

interface RateLimitsClient {
  getRateLimits(): Promise<RawRateLimitsResponse>;
  restart(): Promise<void>;
  close(): void;
}

export class UsageProvider {
  private cache: { value: UsageSnapshot; expiresAt: number } | null = null;
  private inFlight: Promise<UsageSnapshot> | null = null;

  constructor(
    private readonly client: RateLimitsClient = new AppServerClient(),
    private readonly cacheMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  async getUsage(forceRefresh = false): Promise<UsageSnapshot> {
    const nowMs = this.now();
    if (!forceRefresh && this.cache && this.cache.expiresAt > nowMs) return this.cache.value;
    if (!forceRefresh && this.inFlight) return await this.inFlight;

    const request = this.refresh(nowMs);
    if (!forceRefresh) this.inFlight = request;
    try {
      return await request;
    } finally {
      if (this.inFlight === request) this.inFlight = null;
    }
  }

  private async refresh(nowMs: number): Promise<UsageSnapshot> {
    let appServerError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt === 1) await this.client.restart();
        const value = normalizeUsage(await this.client.getRateLimits(), {
          source: "app_server",
          nowMs,
          stale: false,
        });
        this.cache = { value, expiresAt: nowMs + this.cacheMs };
        return value;
      } catch (error) {
        appServerError = error instanceof Error ? error : new Error(String(error));
      }
    }

    try {
      const fallback = await readSessionFallback(nowMs);
      const value = normalizeUsage(fallback.raw, {
        source: "session_fallback",
        nowMs,
        sourceTimestamp: fallback.timestamp,
        stale: fallback.ageMs > 5 * 60_000,
      });
      this.cache = { value, expiresAt: nowMs + Math.min(this.cacheMs, 5_000) };
      return value;
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Unable to read Codex usage. App-server: ${appServerError?.message ?? "unknown error"} Fallback: ${fallbackMessage}`);
    }
  }

  close(): void {
    this.client.close();
  }
}
