import type { UsageBand, UsageSnapshot, WorkAdvice, WorkRecommendation, WorkTask } from "./types.js";

export function usageBand(usage: UsageSnapshot): UsageBand {
  if (usage.rateLimitReachedType || usage.spendControlReached || usage.usedPercent >= 100) return "exhausted";
  if (usage.usedPercent >= 90) return "critical";
  if (usage.usedPercent >= 70) return "guarded";
  return "normal";
}

function scoreTask(task: WorkTask, band: UsageBand, isCurrent: boolean): number {
  let score = task.priority * 1000;
  if (band === "normal") score -= task.estimatedMinutes;
  if (band === "guarded") {
    score -= task.estimatedMinutes * 4;
    if (task.checkpointable) score += 100;
    if (task.canContinueWithoutNewMessage) score += 75;
    if (task.needsUserInput) score -= 150;
  }
  if (band === "critical") {
    score -= task.estimatedMinutes * 10;
    if (task.checkpointable) score += 250;
    if (task.canContinueWithoutNewMessage) score += 250;
    if (task.needsUserInput) score -= 500;
  }
  if (band === "exhausted") {
    score = task.priority * 100;
    if (isCurrent) score += 10_000;
    if (task.canContinueWithoutNewMessage) score += 2_000;
    if (task.checkpointable) score += 500;
    score -= task.estimatedMinutes;
  }
  return score;
}

function reasonFor(task: WorkTask, band: UsageBand, isCurrent: boolean): string {
  if (band === "exhausted" && isCurrent) return "Continue the active task while the current Codex turn can still run.";
  if (band === "critical") return "High-priority, bounded work that can be checkpointed before the usage window closes.";
  if (band === "guarded") return "Good value for the estimated time, with preference for resumable work.";
  return task.priority >= 4 ? "High-priority ready work." : "Ready work ordered by priority and expected duration.";
}

export function adviseWork(tasks: WorkTask[], currentTaskId: string | undefined, usage: UsageSnapshot): WorkAdvice {
  const band = usageBand(usage);
  const recommendedNow: WorkRecommendation[] = [];
  const deferUntilReset: WorkAdvice["deferUntilReset"] = [];

  for (const task of tasks) {
    if (!task.dependenciesReady) {
      deferUntilReset.push({ task, reason: "Dependencies are not ready." });
      continue;
    }
    if (band === "exhausted" && (!task.canContinueWithoutNewMessage || task.needsUserInput)) {
      deferUntilReset.push({
        task,
        reason: task.needsUserInput
          ? "Requires a new user message or decision; defer it while usage is exhausted."
          : "Not safe to continue within the current turn.",
      });
      continue;
    }
    if (band === "critical" && task.needsUserInput) {
      deferUntilReset.push({ task, reason: "Avoid starting work that is likely to require another user turn near the limit." });
      continue;
    }
    const isCurrent = task.id === currentTaskId;
    recommendedNow.push({
      task,
      score: scoreTask(task, band, isCurrent),
      reason: reasonFor(task, band, isCurrent),
    });
  }

  recommendedNow.sort((a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id));
  const checkpoint = band === "exhausted"
    ? "Keep the current turn running, finish a verifiable checkpoint, and record the exact continuation point before requesting input."
    : band === "critical"
      ? "Create a small verified checkpoint after the first recommended task."
      : band === "guarded"
        ? "Checkpoint after each bounded batch so work can resume cleanly."
        : "Use normal verification checkpoints for the selected task.";

  return {
    band,
    primaryRecommendation: recommendedNow[0] ?? null,
    recommendedNow,
    deferUntilReset,
    checkpoint,
    usage,
  };
}
