#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_NAME = "countdown_mcp";
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const testMode = process.argv.includes("--test-mode");
const codexHome = resolve(process.env.CODEX_HOME || join(homedir(), ".codex"));
const installParent = join(codexHome, "mcp");
const target = join(installParent, "countdown-mcp");
const stage = join(installParent, `.countdown-mcp-stage-${process.pid}`);
const backup = join(installParent, `.countdown-mcp-backup-${process.pid}`);
const configPath = join(codexHome, "config.toml");

function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

async function resolveCodexCommand() {
  if (process.env.COUNTDOWN_CODEX_COMMAND) return process.env.COUNTDOWN_CODEX_COMMAND;
  if (process.env.CODEX_CLI_PATH && await exists(process.env.CODEX_CLI_PATH)) return process.env.CODEX_CLI_PATH;
  if (process.platform !== "win32") return "codex";
  const directories = (process.env.PATH || process.env.Path || "").split(delimiter).filter(Boolean);
  for (const filename of ["codex.cmd", "codex.exe"]) {
    for (const directory of directories) {
      const candidate = join(directory.replace(/^"|"$/g, ""), filename);
      if (await exists(candidate)) return candidate;
    }
  }
  return "codex.cmd";
}

async function resolveClaudeCommand() {
  if (process.env.COUNTDOWN_CLAUDE_COMMAND) return process.env.COUNTDOWN_CLAUDE_COMMAND;
  if (process.env.CLAUDE_CLI_PATH && await exists(process.env.CLAUDE_CLI_PATH)) return process.env.CLAUDE_CLI_PATH;
  if (process.platform !== "win32") return "claude";
  const directories = (process.env.PATH || process.env.Path || "").split(delimiter).filter(Boolean);
  for (const filename of ["claude.cmd", "claude.exe"]) {
    for (const directory of directories) {
      const candidate = join(directory.replace(/^"|"$/g, ""), filename);
      if (await exists(candidate)) return candidate;
    }
  }
  return "claude.cmd";
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const isWindowsWrapper = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
    const actualCommand = isWindowsWrapper ? process.env.ComSpec || "cmd.exe" : command;
    const actualArgs = isWindowsWrapper ? ["/d", "/s", "/c", command, ...args] : args;
    const child = spawn(actualCommand, actualArgs, {
      cwd: options.cwd || sourceRoot,
      env: options.env || process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}.${stderr ? `\n${stderr}` : ""}`));
    });
  });
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function assertSafeInstallPath(path) {
  const resolved = resolve(path);
  if (basename(resolved) !== "countdown-mcp" || dirname(resolved) !== resolve(installParent)) {
    throw new Error(`Refusing unsafe installation target: ${resolved}`);
  }
}

async function nodeMajor() {
  return Number(process.versions.node.split(".")[0]);
}

async function restoreConfig(originalConfig) {
  if (originalConfig === null) {
    if (await exists(configPath)) await rm(configPath, { force: true });
    return;
  }
  await mkdir(dirname(configPath), { recursive: true });
  const temp = `${configPath}.countdown-rollback-${process.pid}`;
  await writeFile(temp, originalConfig, "utf8");
  await rename(temp, configPath);
}

// Registers CountdownMCP with Claude Code when its CLI is present on this
// machine. This is best-effort and additive only: it never gates or rolls
// back the Codex installation above, since a machine may have either CLI,
// both, or neither installed.
async function registerWithClaudeCode(scriptPath) {
  const claudeCommand = await resolveClaudeCommand();
  try {
    await run(claudeCommand, ["--version"], { capture: true });
  } catch {
    return false;
  }
  try {
    await run(claudeCommand, ["mcp", "remove", SERVER_NAME], { capture: true }).catch(() => {});
    await run(claudeCommand, ["mcp", "add", SERVER_NAME, "--", process.execPath, scriptPath], { capture: true });
    console.log(`CountdownMCP also registered with Claude Code as ${SERVER_NAME}. Restart Claude Code to load it.`);
    return true;
  } catch (error) {
    console.error(`Claude Code detected but registration failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main() {
  assertSafeInstallPath(target);
  if (await nodeMajor() < 18) throw new Error("CountdownMCP requires Node.js 18 or newer.");
  const codexCommand = await resolveCodexCommand();
  await run(codexCommand, ["--version"], { capture: true });

  console.log("Preparing CountdownMCP...");
  const sourceHasLock = await exists(join(sourceRoot, "package-lock.json"));
  await run(executable("npm"), sourceHasLock ? ["ci"] : ["install"], { cwd: sourceRoot });
  await run(executable("npm"), ["run", "typecheck"], { cwd: sourceRoot });
  await run(executable("npm"), ["test"], { cwd: sourceRoot });
  await run(executable("npm"), ["run", "build"], { cwd: sourceRoot });
  if (!testMode) await run(executable("npm"), ["run", "smoke"], { cwd: sourceRoot });

  await mkdir(installParent, { recursive: true });
  await rm(stage, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const distributionFiles = ["dist", "package.json", "README.md", "LICENSE"];
  if (sourceHasLock) distributionFiles.push("package-lock.json");
  for (const name of distributionFiles) {
    await cp(join(sourceRoot, name), join(stage, name), { recursive: true });
  }
  await run(
    executable("npm"),
    sourceHasLock
      ? ["ci", "--omit=dev", "--ignore-scripts"]
      : ["install", "--omit=dev", "--ignore-scripts"],
    { cwd: stage },
  );
  await access(join(stage, "dist", "server.js"), constants.R_OK);

  const originalConfig = await exists(configPath) ? await readFile(configPath, "utf8") : null;
  const hadTarget = await exists(target);
  let targetSwapped = false;
  try {
    if (hadTarget) await rename(target, backup);
    await rename(stage, target);
    targetSwapped = true;

    const existing = await run(codexCommand, ["mcp", "get", SERVER_NAME, "--json"], { capture: true })
      .then(() => true, () => false);
    if (existing) await run(codexCommand, ["mcp", "remove", SERVER_NAME], { capture: true });
    await run(codexCommand, ["mcp", "add", SERVER_NAME, "--", process.execPath, join(target, "dist", "server.js")], { capture: true });
    await run(codexCommand, ["mcp", "get", SERVER_NAME, "--json"], { capture: true });

    await rm(backup, { recursive: true, force: true });
    console.log(`CountdownMCP installed and registered as ${SERVER_NAME}. Restart Codex to load it.`);

    await registerWithClaudeCode(join(target, "dist", "server.js"));
  } catch (error) {
    await restoreConfig(originalConfig);
    if (targetSwapped) await rm(target, { recursive: true, force: true });
    if (hadTarget && await exists(backup)) await rename(backup, target);
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
    if (!hadTarget) await rm(backup, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
