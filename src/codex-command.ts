import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export function resolveCodexCommand(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (env.COUNTDOWN_CODEX_COMMAND) return env.COUNTDOWN_CODEX_COMMAND;
  if (env.CODEX_CLI_PATH && existsSync(env.CODEX_CLI_PATH)) return env.CODEX_CLI_PATH;
  if (platform !== "win32") return "codex";

  const directories = (env.PATH || env.Path || "").split(delimiter).filter(Boolean);
  // Prefer the npm/CLI wrapper on Windows. Packaged WindowsApps executables can
  // be discoverable on PATH yet reject direct child-process launches with EPERM.
  for (const filename of ["codex.cmd", "codex.exe"]) {
    for (const directory of directories) {
      const candidate = join(directory.replace(/^"|"$/g, ""), filename);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "codex.cmd";
}
