import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type UsageReader } from "../src/server.js";
import { usageFixture } from "./fixtures.js";

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function connectedClient(usedPercent = 25): Promise<Client> {
  const provider: UsageReader = {
    getUsage: async () => usageFixture(usedPercent),
    close: () => undefined,
  };
  const { server, close } = createServer(provider);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "countdown-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(async () => { close(); await client.close(); await server.close(); });
  return client;
}

describe("CountdownMCP server", () => {
  it("advertises exactly the two prefixed read-only tools", async () => {
    const client = await connectedClient();
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual(["countdown_get_usage", "countdown_advise_work"]);
    expect(client.getInstructions()).toContain("Do not call CountdownMCP for small");
    expect(client.getInstructions()).toContain("more than 10 minutes");
    expect(client.getInstructions()).toContain("at least three meaningful execution steps");
    expect(client.getInstructions()).toContain("multiple substantial prompts");
    for (const tool of result.tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.description).toContain("Do not call it for small");
      expect(tool.description).toContain("more than 10 minutes");
    }
    expect(result.tools[0].inputSchema).toMatchObject({ additionalProperties: false });
  });

  it("returns structured usage", async () => {
    const client = await connectedClient(31);
    const result = await client.callTool({ name: "countdown_get_usage", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ planType: "plus", usedPercent: 31, remainingPercent: 69 });
  });

  it("accepts WorkCandidate v1 plus unknown fields and returns TodoMCP advice fields", async () => {
    const client = await connectedClient(100);
    const result = await client.callTool({
      name: "countdown_advise_work",
      arguments: {
        currentTaskId: "a",
        ignoredFutureField: true,
        tasks: [
          {
            id: "a", title: "Active", priority: 3, estimatedMinutes: 20,
            dependenciesReady: true, needsUserInput: false,
            canContinueWithoutNewMessage: true, checkpointable: true,
            futureTaskField: "ignored",
          },
          {
            id: "b", title: "Blocked", priority: 5, estimatedMinutes: 10,
            dependenciesReady: false, needsUserInput: false,
            canContinueWithoutNewMessage: true, checkpointable: true,
          },
        ],
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      recommendedNow: ["a"],
      deferUntilReset: ["b"],
      executionOrder: ["a"],
      source: "countdown-mcp",
      band: "exhausted",
    });
  });
});
