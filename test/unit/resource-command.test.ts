import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeVersionCheckCache } from "../../src/config/store.js";
import { resourceCommand } from "../../src/commands/resource.js";

function cli(): Command {
  const root = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <token>");
  root.addCommand(resourceCommand());
  return root;
}

function mockFetch(body: unknown = { entries: [], total_count: 0 }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  writeVersionCheckCache("https://demo.example.com", {
    serverVersion: "0.1.5",
    checkedAt: new Date().toISOString(),
  });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resourceCommand", () => {
  it("documents enabled-state commands in the command summary", () => {
    const command = resourceCommand();

    expect(command.description()).toContain("enable, disable");
    expect(command.commands.map((child) => child.name())).toEqual(
      expect.arrayContaining(["enable", "disable"]),
    );
  });

  it("forwards the enabled filter as a boolean", async () => {
    const fetchMock = mockFetch();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "resource",
        "list",
        "--enabled",
        "false",
      ],
      { from: "user" },
    );

    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams.get("enabled")).toBe(
      "false",
    );
  });

  it("rejects invalid enabled filters before requesting resources", async () => {
    const fetchMock = mockFetch();

    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "resource",
          "list",
          "--enabled",
          "invalid",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow("--enabled must be one of: true | false");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
