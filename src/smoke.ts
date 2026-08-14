import { AppServerClient } from "./app-server-client.js";
import { normalizeUsage } from "./normalize.js";

async function main(): Promise<void> {
  const client = new AppServerClient();
  try {
    const usage = normalizeUsage(await client.getRateLimits(), { source: "app_server" });
    if (!usage.planType || usage.remainingPercent < 0 || usage.remainingPercent > 100) {
      throw new Error("Codex returned an invalid usage snapshot.");
    }
    process.stdout.write(`COUNTDOWN_SMOKE_PASS plan=${usage.planType} remaining=${usage.remainingPercent}%\n`);
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
