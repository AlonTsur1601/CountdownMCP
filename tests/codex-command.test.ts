import { describe, expect, it } from "vitest";
import { resolveCodexCommand } from "../src/codex-command.js";

describe("resolveCodexCommand", () => {
  it("uses an explicit override on every platform", () => {
    expect(resolveCodexCommand({ COUNTDOWN_CODEX_COMMAND: "/custom/codex" }, "linux")).toBe("/custom/codex");
  });

  it("uses the normal executable name on POSIX", () => {
    expect(resolveCodexCommand({ PATH: "/usr/bin" }, "linux")).toBe("codex");
  });
});
