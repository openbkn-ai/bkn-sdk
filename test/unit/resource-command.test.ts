import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resourceCommand } from "../../src/commands/resource.js";
import { writeVersionCheckCache } from "../../src/config/store.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  writeVersionCheckCache("https://demo.example.com", {
    serverVersion: "0.1.5",
    checkedAt: new Date().toISOString(),
  });
});

async function run(args: string[]): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ entries: [], total_count: 0 }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const root = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <t>");
  root.addCommand(resourceCommand());
  await root.parseAsync(["--base-url", "https://demo.example.com", "--token", "t", ...args], {
    from: "user",
  });
  return fetchMock;
}

describe("resourceCommand", () => {
  it("documents enabled-state commands in the command summary", () => {
    const command = resourceCommand();

    expect(command.description()).toContain("enable, disable");
    expect(command.commands.map((child) => child.name())).toEqual(
      expect.arrayContaining(["enable", "disable"]),
    );
  });

  it("sends the documented query options on resource query", async () => {
    const fetchMock = await run([
      "resource",
      "query",
      "r-1",
      "--filter",
      '{"field":"id","operation":"==","value":1,"value_from":"const"}',
      "--sort",
      "id:desc",
      "--output-fields",
      "id",
      "--binary-mode",
      "metadata",
      "--ignore-local-index",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      filter_condition: { field: "id", operation: "==", value: 1, value_from: "const" },
      paging: { mode: "single", limit: 50, offset: 0 },
      sort: [{ field: "id", direction: "desc" }],
      output_fields: ["id"],
      binary_mode: "metadata",
      ignore_local_index: true,
      need_total: false,
    });
  });

  it("rejects an unknown category and a malformed sort before any request", async () => {
    await expect(run(["resource", "list", "--category", "view"])).rejects.toThrow(
      /--category must be one of/,
    );
    await expect(run(["resource", "query", "r-1", "--sort", "id:sideways"])).rejects.toThrow(
      /field\[:asc\|desc\]/,
    );
  });
});
