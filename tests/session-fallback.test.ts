import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSessionFallback } from "../src/session-fallback.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("readSessionFallback", () => {
  it("extracts only the latest rate limit snapshot from session metadata", async () => {
    const root = join(tmpdir(), `countdown-fallback-${process.pid}-${Date.now()}`);
    roots.push(root);
    const sessions = join(root, "sessions", "2026", "08", "14");
    await mkdir(sessions, { recursive: true });
    const secret = "SECRET_CHAT_CONTENT";
    const lines = [
      JSON.stringify({ timestamp: "2026-08-14T00:00:00Z", type: "response_item", payload: { text: secret } }),
      JSON.stringify({
        timestamp: "2026-08-14T00:01:00Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_tokens: 999 },
          rate_limits: {
            limit_id: "codex",
            primary: { used_percent: 44, window_minutes: 10_080, resets_at: 2_000_000_000 },
            plan_type: "plus",
          },
        },
      }),
    ];
    await writeFile(join(sessions, "rollout.jsonl"), lines.join("\n"), "utf8");
    const result = await readSessionFallback(Date.parse("2026-08-14T00:02:00Z"), root);
    expect(result.raw.rateLimits.plan_type).toBe("plus");
    expect(result.raw.rateLimits.primary?.used_percent).toBe(44);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("total_tokens");
  });

  it("rejects malformed records without returning their contents", async () => {
    const root = join(tmpdir(), `countdown-fallback-${process.pid}-${Date.now()}`);
    roots.push(root);
    const sessions = join(root, "sessions");
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, "bad.jsonl"), '{"rate_limits":"secret","token_count":', "utf8");
    await expect(readSessionFallback(Date.now(), root)).rejects.toThrow(/No recent/);
  });
});
