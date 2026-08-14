import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolveCodexCommand } from "./codex-command.js";
import type { RawRateLimitsResponse } from "./types.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class AppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private initializing: Promise<void> | null = null;
  private stderrTail = "";

  constructor(
    private readonly command = resolveCodexCommand(),
    private readonly requestTimeoutMs = 10_000,
  ) {
    super();
  }

  async getRateLimits(): Promise<RawRateLimitsResponse> {
    await this.ensureStarted();
    return await this.request<RawRateLimitsResponse>("account/rateLimits/read");
  }

  async restart(): Promise<void> {
    this.close();
    await this.ensureStarted();
  }

  close(): void {
    const child = this.child;
    this.child = null;
    this.initializing = null;
    if (child && !child.killed) child.kill();
    this.rejectAll(new Error("Codex app-server connection closed."));
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return;
    if (this.initializing) return await this.initializing;
    this.initializing = this.start();
    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  private async start(): Promise<void> {
    const isWindowsWrapper = process.platform === "win32" && /\.cmd$/i.test(this.command);
    const command = isWindowsWrapper ? process.env.ComSpec || "cmd.exe" : this.command;
    const args = isWindowsWrapper
      ? ["/d", "/s", "/c", this.command, "app-server", "--stdio"]
      : ["app-server", "--stdio"];
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
      shell: false,
    });
    this.child = child;
    this.buffer = "";
    this.stderrTail = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-8192);
    });
    child.on("error", (error) => this.onExit(error));
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.onExit(new Error(`Codex app-server exited (${code ?? signal ?? "unknown"}). ${this.stderrTail}`));
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        child.off("spawn", onSpawn);
        reject(error);
      };
      const onSpawn = () => {
        child.off("error", onError);
        resolve();
      };
      child.once("error", onError);
      child.once("spawn", onSpawn);
    });

    await this.request("initialize", {
      clientInfo: { name: "countdown-mcp", version: "0.1.0" },
      capabilities: { experimentalApi: false },
    });
    this.notify("initialized");
  }

  private request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.child || this.child.killed) {
      return Promise.reject(new Error("Codex app-server is not running."));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server method ${method}.`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
  }

  private notify(method: string, params?: unknown): void {
    if (!this.child || this.child.killed) return;
    this.child.stdin.write(`${JSON.stringify({ method, ...(params === undefined ? {} : { params }) })}\n`);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue;
      }
      if (typeof message.id !== "number") continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "Codex app-server request failed."));
      else pending.resolve(message.result);
    }
  }

  private onExit(error: Error): void {
    this.child = null;
    this.initializing = null;
    this.rejectAll(error);
    this.emit("exit", error);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
