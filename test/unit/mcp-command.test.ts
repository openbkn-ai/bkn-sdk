import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const { list, get, tools } = vi.hoisted(() => ({
  list: vi.fn(async () => ({ data: [] })),
  get: vi.fn(async () => ({ mcp_id: "m1" })),
  tools: vi.fn(async () => ({ tools: [] })),
}));

vi.mock("../../src/commands/_shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commands/_shared.js")>();
  return { ...actual, clientFrom: vi.fn(() => ({ mcp: { list, get, tools } })) };
});

import { describeCommandTree } from "../../src/commands/describe.js";
import { mcpCommand, redactMcpOutput } from "../../src/commands/mcp.js";

function run(...argv: string[]): Promise<Command> {
  return new Command("openbkn")
    .exitOverride()
    .option("--json")
    .option("--compact")
    .addCommand(mcpCommand())
    .parseAsync(["node", "openbkn", "--json", ...argv]);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("openbkn mcp", () => {
  it("maps CLI list flags to the SDK options", async () => {
    await run(
      "mcp",
      "list",
      "--name",
      "weather",
      "--status",
      "published",
      "--internal",
      "--mode",
      "stream",
      "--limit",
      "5",
      "--page",
      "2",
      "--all",
    );
    expect(list).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
      sortBy: undefined,
      sortOrder: undefined,
      name: "weather",
      source: undefined,
      category: undefined,
      status: "published",
      createUser: undefined,
      isInternal: true,
      mode: "stream",
      all: true,
    });
  });

  it("routes get and tools to the matching read resource", async () => {
    await run("mcp", "get", "mcp-1");
    await run("mcp", "tools", "mcp-1");
    expect(get).toHaveBeenCalledWith("mcp-1");
    expect(tools).toHaveBeenCalledWith("mcp-1", { draft: undefined });
  });

  it("marks every MCP command as READ and sources mcp ids from the list", () => {
    const tree = describeCommandTree(new Command("openbkn").addCommand(mcpCommand())) as {
      commands: Array<{
        commands?: Array<{ section: string; arguments?: Array<{ from?: string }> }>;
      }>;
    };
    const commands = tree.commands[0]?.commands ?? [];
    expect(commands.map((command) => command.section)).toEqual(["READ", "READ", "READ"]);
    expect(commands[1]?.arguments?.[0]?.from).toBe("openbkn mcp list");
    expect(commands[2]?.arguments?.[0]?.from).toBe("openbkn mcp list");
  });

  it("redacts credentials nested in an MCP response before CLI output", () => {
    expect(
      redactMcpOutput({ headers: { Authorization: "Bearer upstream-secret" }, create_time: 1n }),
    ).toEqual({ headers: { Authorization: "<redacted>" }, create_time: 1n });
  });

  it("masks env values, secret launch args, URL secrets and credential-named scalars", () => {
    expect(
      redactMcpOutput({
        data: [
          {
            mode: "stdio_npx",
            command: "npx",
            args: ["server", "--token", "t1", "--api-key=k1", "DB_PASS=p1", "--port", "8080"],
            env: { AWS_ACCESS_KEY_ID: "id", REGION: "cn" },
            url: "https://user:pw@upstream.example.com/mcp?access_token=abc&tenant=t",
            x_api_key: "k2",
            max_tokens: 10,
          },
        ],
      }),
    ).toEqual({
      data: [
        {
          mode: "stdio_npx",
          command: "npx",
          args: [
            "server",
            "--token",
            "<redacted>",
            "--api-key=<redacted>",
            "DB_PASS=<redacted>",
            "--port",
            "8080",
          ],
          env: { AWS_ACCESS_KEY_ID: "<redacted>", REGION: "<redacted>" },
          url: "https://user:%3Credacted%3E@upstream.example.com/mcp?access_token=%3Credacted%3E&tenant=t",
          x_api_key: "<redacted>",
          max_tokens: 10,
        },
      ],
    });
  });

  it("prints tool input schemas as advertised even when parameters look like credentials", () => {
    const tools = {
      tools: [
        {
          name: "complete",
          inputSchema: {
            type: "object",
            properties: { api_key: { type: "string" }, max_tokens: { type: "integer" } },
            required: ["api_key"],
          },
        },
      ],
    };
    expect(redactMcpOutput(tools)).toEqual(tools);
  });

  it("passes --draft to tool discovery and validates list bounds and enums", async () => {
    await run("mcp", "tools", "mcp-1", "--draft");
    expect(tools).toHaveBeenCalledWith("mcp-1", { draft: true });
    await expect(run("mcp", "list", "--limit", "101")).rejects.toThrow(/--limit/);
    await expect(run("mcp", "list", "--page", "1e3")).rejects.toThrow(/--page/);
    await expect(run("mcp", "list", "--mode", "http")).rejects.toThrow();
    expect(list).not.toHaveBeenCalled();
  });
});
