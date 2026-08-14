import { describe, expect, it } from "vitest";
import { adviseWork, usageBand } from "../src/advice.js";
import type { WorkTask } from "../src/types.js";
import { usageFixture } from "./fixtures.js";

const base: WorkTask = {
  id: "task-a",
  title: "Task A",
  priority: 3,
  estimatedMinutes: 30,
  dependenciesReady: true,
  needsUserInput: false,
  canContinueWithoutNewMessage: true,
  checkpointable: true,
};

describe("usageBand", () => {
  it.each([[0, "normal"], [69, "normal"], [70, "guarded"], [89, "guarded"], [90, "critical"], [99, "critical"], [100, "exhausted"]] as const)(
    "maps %i%% used to %s",
    (used, band) => expect(usageBand(usageFixture(used))).toBe(band),
  );
});

describe("adviseWork", () => {
  it("orders normal work by priority before duration", () => {
    const result = adviseWork([
      base,
      { ...base, id: "task-b", title: "Task B", priority: 5, estimatedMinutes: 90 },
    ], undefined, usageFixture(10));
    expect(result.recommendedNow.map((item) => item.task.id)).toEqual(["task-b", "task-a"]);
  });

  it("defers tasks requiring user input in the critical band", () => {
    const result = adviseWork([
      { ...base, needsUserInput: true },
      { ...base, id: "task-b", title: "Task B" },
    ], undefined, usageFixture(95));
    expect(result.recommendedNow.map((item) => item.task.id)).toEqual(["task-b"]);
    expect(result.deferUntilReset.map((item) => item.task.id)).toEqual(["task-a"]);
  });

  it("continues the active safe task at 0% remaining", () => {
    const result = adviseWork([
      base,
      { ...base, id: "task-b", title: "Task B", priority: 5 },
      { ...base, id: "task-c", title: "Task C", canContinueWithoutNewMessage: false },
    ], "task-a", usageFixture(100));
    expect(result.primaryRecommendation?.task.id).toBe("task-a");
    expect(result.recommendedNow.map((item) => item.task.id)).toContain("task-b");
    expect(result.deferUntilReset.map((item) => item.task.id)).toContain("task-c");
  });

  it("never recommends a task whose dependencies are not ready", () => {
    const result = adviseWork([{ ...base, dependenciesReady: false }], undefined, usageFixture(5));
    expect(result.recommendedNow).toHaveLength(0);
    expect(result.deferUntilReset[0]?.reason).toMatch(/Dependencies/);
  });
});
