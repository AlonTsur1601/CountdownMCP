#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { adviseWork } from "./advice.js";
import { UsageProvider } from "./usage-provider.js";
import type { UsageSnapshot, WorkTask } from "./types.js";

const SERVER_INSTRUCTIONS = [
  "Do not call CountdownMCP for small, self-contained, low-risk tasks that can reasonably finish in one short turn; execute them directly.",
  "For large or multi-stage work, call countdown_get_usage before choosing scope.",
  "Use countdown_advise_work with TodoMCP WorkCandidate v1 tasks when candidates are available.",
  "Do not poll usage repeatedly; responses are cached briefly.",
  "At 0% remaining, do not stop an active turn solely because the limit is exhausted: continue safe work that needs no new user message, verify a checkpoint, and preserve an exact continuation point.",
  "CountdownMCP is advisory only and never overrides dependencies or completion gates.",
].join(" ");

const usageWindowSchema = {
  usedPercent: z.number().int().min(0).max(100),
  remainingPercent: z.number().int().min(0).max(100),
  durationMinutes: z.number().int().nullable(),
  resetsAt: z.number().int().nullable(),
  resetsAtIso: z.string().nullable(),
  secondsUntilReset: z.number().int().nullable(),
};

const usageOutputSchema = {
  planType: z.string(),
  usedPercent: z.number().int().min(0).max(100),
  remainingPercent: z.number().int().min(0).max(100),
  effectiveLimitId: z.string(),
  buckets: z.record(z.string(), z.object({
    limitId: z.string(),
    limitName: z.string().nullable(),
    planType: z.string(),
    primary: z.object(usageWindowSchema).nullable(),
    secondary: z.object(usageWindowSchema).nullable(),
    effectiveWindow: z.enum(["primary", "secondary"]).nullable(),
    usedPercent: z.number().int(),
    remainingPercent: z.number().int(),
    credits: z.object({
      hasCredits: z.boolean(),
      unlimited: z.boolean(),
      balance: z.string().nullable(),
    }).nullable(),
    individualLimit: z.unknown(),
    spendControlReached: z.boolean().nullable(),
    rateLimitReachedType: z.string().nullable(),
  })),
  credits: z.object({
    hasCredits: z.boolean(),
    unlimited: z.boolean(),
    balance: z.string().nullable(),
  }).nullable(),
  spendControlReached: z.boolean().nullable(),
  rateLimitReachedType: z.string().nullable(),
  resetCreditsAvailable: z.number().int().nullable(),
  source: z.enum(["app_server", "session_fallback"]),
  sampledAt: z.string(),
  sourceTimestamp: z.string().nullable(),
  stale: z.boolean(),
};

const workCandidateSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  priority: z.number().int().min(1).max(5),
  estimatedMinutes: z.number().int().positive().max(100_000),
  dependenciesReady: z.boolean(),
  needsUserInput: z.boolean(),
  canContinueWithoutNewMessage: z.boolean(),
  checkpointable: z.boolean(),
}).passthrough();

function usageText(usage: UsageSnapshot): string {
  const plan = usage.planType === "unknown" ? "an unknown plan" : `the ${usage.planType} plan`;
  const reset = usage.buckets[usage.effectiveLimitId]?.[
    usage.buckets[usage.effectiveLimitId].effectiveWindow ?? "primary"
  ]?.resetsAtIso;
  const credit = usage.credits?.unlimited
    ? " Credits are unlimited."
    : usage.credits?.balance != null ? ` Credit balance: ${usage.credits.balance}.` : "";
  const stale = usage.stale ? " This is a stale fallback snapshot." : "";
  return `${usage.remainingPercent}% remains on ${plan} (${usage.usedPercent}% used).${reset ? ` Resets at ${reset}.` : ""}${credit}${stale}`;
}

export interface UsageReader {
  getUsage(forceRefresh?: boolean): Promise<UsageSnapshot>;
  close(): void;
}

export function createServer(provider: UsageReader = new UsageProvider()): { server: McpServer; close: () => void } {
  const server = new McpServer(
    { name: "countdown-mcp", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "countdown_get_usage",
    {
      title: "Get Codex usage",
      description: "Use this before large or multi-stage work to read the current Codex plan, remaining usage, reset window, credits, and limit state. Do not call it for small, self-contained tasks that can finish in one short turn.",
      inputSchema: {},
      outputSchema: usageOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        const usage = await provider.getUsage();
        return {
          structuredContent: usage as unknown as Record<string, unknown>,
          content: [{ type: "text", text: usageText(usage) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );

  server.registerTool(
    "countdown_advise_work",
    {
      title: "Advise which work to do",
      description: "Use this with TodoMCP WorkCandidate v1 tasks for large or multi-stage work. Do not call it for small, self-contained tasks that can finish in one short turn. Advisory only; it does not store tasks or override dependencies.",
      inputSchema: {
        currentTaskId: z.string().min(1).max(100).optional(),
        tasks: z.array(workCandidateSchema).min(1).max(1_000),
      },
      outputSchema: {
        recommendedNow: z.array(z.string()),
        deferUntilReset: z.array(z.string()),
        executionOrder: z.array(z.string()),
        checkpoint: z.string().optional(),
        source: z.literal("countdown-mcp"),
        band: z.enum(["normal", "guarded", "critical", "exhausted"]),
        usage: z.object(usageOutputSchema),
        reasons: z.record(z.string(), z.string()),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async ({ currentTaskId, tasks }) => {
      try {
        const usage = await provider.getUsage();
        const normalizedTasks: WorkTask[] = tasks.map((task) => ({
          id: task.id,
          title: task.title,
          priority: task.priority,
          estimatedMinutes: task.estimatedMinutes,
          dependenciesReady: task.dependenciesReady,
          needsUserInput: task.needsUserInput,
          canContinueWithoutNewMessage: task.canContinueWithoutNewMessage,
          checkpointable: task.checkpointable,
        }));
        const advice = adviseWork(normalizedTasks, currentTaskId, usage);
        const recommendedNow = advice.recommendedNow.map((item) => item.task.id);
        const deferUntilReset = advice.deferUntilReset.map((item) => item.task.id);
        const reasons = Object.fromEntries([
          ...advice.recommendedNow.map((item) => [item.task.id, item.reason]),
          ...advice.deferUntilReset.map((item) => [item.task.id, item.reason]),
        ]);
        const output = {
          recommendedNow,
          deferUntilReset,
          executionOrder: recommendedNow,
          checkpoint: advice.checkpoint,
          source: "countdown-mcp" as const,
          band: advice.band,
          usage,
          reasons,
        };
        return {
          structuredContent: output,
          content: [{
            type: "text",
            text: advice.primaryRecommendation
              ? `${usageText(usage)} Recommended now: ${advice.primaryRecommendation.task.title}. ${advice.checkpoint}`
              : `${usageText(usage)} No supplied task is safe and ready to start now. ${advice.checkpoint}`,
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );

  return { server, close: () => provider.close() };
}

async function main(): Promise<void> {
  const { server, close } = createServer();
  const shutdown = () => {
    close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
