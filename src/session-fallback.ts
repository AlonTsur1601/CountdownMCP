import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RawRateLimitsResponse, RawRateLimitSnapshot } from "./types.js";

interface SessionSnapshot {
  raw: RawRateLimitsResponse;
  timestamp: string;
  ageMs: number;
}

const MAX_FILES = 12;
const MAX_BYTES_PER_FILE = 8 * 1024 * 1024;
const CHUNK_SIZE = 512 * 1024;

async function collectJsonlFiles(root: string, output: Array<{ path: string; mtimeMs: number }>): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await collectJsonlFiles(path, output);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      try {
        output.push({ path, mtimeMs: (await stat(path)).mtimeMs });
      } catch {
        // A live session can rotate while it is being scanned.
      }
    }
  }
}

async function readTail(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const size = (await handle.stat()).size;
    const bytesToRead = Math.min(size, MAX_BYTES_PER_FILE);
    let position = size;
    let result = "";
    while (position > size - bytesToRead) {
      const length = Math.min(CHUNK_SIZE, position - (size - bytesToRead));
      position -= length;
      const buffer = Buffer.allocUnsafe(length);
      await handle.read(buffer, 0, length, position);
      result = buffer.toString("utf8") + result;
    }
    return result;
  } finally {
    await handle.close();
  }
}

function extractSnapshot(text: string, nowMs: number): SessionSnapshot | null {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (!line.includes('"rate_limits"') || !line.includes('"token_count"')) continue;
    try {
      const event = JSON.parse(line) as {
        timestamp?: string;
        payload?: { type?: string; rate_limits?: RawRateLimitSnapshot };
      };
      if (event.payload?.type !== "token_count" || !event.payload.rate_limits) continue;
      const timestamp = typeof event.timestamp === "string" ? event.timestamp : new Date(0).toISOString();
      const limitId = event.payload.rate_limits.limit_id ?? event.payload.rate_limits.limitId ?? "codex";
      return {
        raw: {
          rateLimits: event.payload.rate_limits,
          rateLimitsByLimitId: { [limitId]: event.payload.rate_limits },
          rateLimitResetCredits: null,
        },
        timestamp,
        ageMs: Math.max(0, nowMs - Date.parse(timestamp)),
      };
    } catch {
      // Ignore malformed or partially written JSONL records.
    }
  }
  return null;
}

export async function readSessionFallback(
  nowMs = Date.now(),
  codexHome = process.env.CODEX_HOME || join(homedir(), ".codex"),
): Promise<SessionSnapshot> {
  const files: Array<{ path: string; mtimeMs: number }> = [];
  await collectJsonlFiles(join(codexHome, "sessions"), files);
  await collectJsonlFiles(join(codexHome, "archived_sessions"), files);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const file of files.slice(0, MAX_FILES)) {
    try {
      const snapshot = extractSnapshot(await readTail(file.path), nowMs);
      if (snapshot) return snapshot;
    } catch {
      // Try the next recent session without exposing file content.
    }
  }
  throw new Error("No recent Codex rate-limit snapshot was found in local session metadata.");
}
