// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { capabilityList, capabilityAttach, capabilityDetach } = vi.hoisted(() => ({
  capabilityList: vi.fn(async () => ({ entries: [], total_count: 0, boxes: [] })),
  capabilityAttach: vi.fn(async () => ({ entries: [], total_count: 0, boxes: [] })),
  capabilityDetach: vi.fn(async () => undefined),
}));

vi.mock("../../src/commands/_shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commands/_shared.js")>();
  return {
    ...actual,
    clientFrom: vi.fn(() => ({ kn: { capabilityList, capabilityAttach, capabilityDetach } })),
  };
});

import { bknCommand, warnUnboundCapabilities } from "../../src/commands/bkn.js";

function run(...argv: string[]): Promise<Command> {
  return new Command("openbkn")
    .exitOverride()
    .option("--json")
    .option("--compact")
    .addCommand(bknCommand())
    .parseAsync(["node", "openbkn", "--json", ...argv]);
}

function stdout(): string {
  return vi
    .mocked(process.stdout.write)
    .mock.calls.map((c) => String(c[0]))
    .join("");
}

function stderr(): string {
  return vi
    .mocked(process.stderr.write)
    .mock.calls.map((c) => String(c[0]))
    .join("");
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("openbkn bkn capability attach", () => {
  it("binds skills by id, one entry per id", async () => {
    await run("bkn", "capability", "attach", "kn-a", "--skill", "s1,s2", "--branch", "dev");
    expect(capabilityAttach).toHaveBeenCalledWith(
      "kn-a",
      [
        { capability_type: "skill", capability_id: "s1", comment: undefined },
        { capability_type: "skill", capability_id: "s2", comment: undefined },
      ],
      { branch: "dev" },
    );
  });

  it("binds named tools of a box, one entry per tool", async () => {
    await run("bkn", "capability", "attach", "kn-a", "--box", "b1", "--tool", "t1,t2");
    expect(capabilityAttach).toHaveBeenCalledWith(
      "kn-a",
      [
        { capability_type: "function", box_id: "b1", capability_id: "t1", comment: undefined },
        { capability_type: "function", box_id: "b1", capability_id: "t2", comment: undefined },
      ],
      { branch: undefined },
    );
  });

  it("sends --all-tools as one entry for the backend to expand", async () => {
    await run("bkn", "capability", "attach", "kn-a", "--box", "b1", "--all-tools");
    expect(capabilityAttach).toHaveBeenCalledWith(
      "kn-a",
      [{ capability_type: "function", box_id: "b1", all_tools: true, comment: undefined }],
      { branch: undefined },
    );
  });

  it("binds MCP Server tools by name", async () => {
    await run("bkn", "capability", "attach", "kn-a", "--mcp", "m1", "--tool", "search");
    expect(capabilityAttach).toHaveBeenCalledWith(
      "kn-a",
      [{ capability_type: "mcp_tool", box_id: "m1", capability_id: "search", comment: undefined }],
      { branch: undefined },
    );
  });

  it.each([
    [["--box", "b1"], "--box binds tools, not the container"],
    [["--mcp", "m1"], "--mcp binds tools, not the container"],
    [["--box", "b1", "--tool", "t1", "--all-tools"], "Use --tool or --all-tools, not both"],
    [["--skill", "s1", "--tool", "t1"], "go with --box or --mcp"],
    [["--skill", "s1", "--all-tools"], "go with --box or --mcp"],
    [["--skill", "s1", "--box", "b1", "--tool", "t1"], "Name exactly one of"],
    [["--tool", "t1"], "Name exactly one of"],
    [[], "Name exactly one of"],
    [["--skill", " , "], "--skill needs at least one skill id"],
  ])("refuses %j before calling the backend", async (flags, message) => {
    await expect(run("bkn", "capability", "attach", "kn-a", ...flags)).rejects.toThrow(message);
    expect(capabilityAttach).not.toHaveBeenCalled();
  });
});

describe("openbkn bkn capability detach", () => {
  it("releases comma-separated binding ids in one call and says which", async () => {
    await run("bkn", "capability", "detach", "kn-a", "id1, id2", "--branch", "dev");
    expect(capabilityDetach).toHaveBeenCalledWith("kn-a", ["id1", "id2"], { branch: "dev" });
    expect(JSON.parse(stdout())).toEqual({
      kn_id: "kn-a",
      branch: "dev",
      detached: ["id1", "id2"],
    });
  });

  it("refuses an empty id list", async () => {
    await expect(run("bkn", "capability", "detach", "kn-a", " , ")).rejects.toThrow(
      "Name at least one binding id",
    );
    expect(capabilityDetach).not.toHaveBeenCalled();
  });
});

describe("openbkn bkn capability list", () => {
  it("maps every filter onto the list call", async () => {
    await run(
      "bkn",
      "capability",
      "list",
      "kn-a",
      "--type",
      "function",
      "--box",
      "b1",
      "--metadata-type",
      "openapi",
      "--with-detail",
      "--branch",
      "dev",
      "--limit",
      "5",
      "--offset",
      "10",
    );
    expect(capabilityList).toHaveBeenCalledWith("kn-a", {
      branch: "dev",
      type: "function",
      boxId: "b1",
      metadataType: "openapi",
      withDetail: true,
      limit: 5,
      offset: 10,
    });
  });

  it("refuses an unknown --type", async () => {
    await expect(run("bkn", "capability", "list", "kn-a", "--type", "tool")).rejects.toThrow(
      "--type must be one of skill, function, mcp_tool",
    );
    expect(capabilityList).not.toHaveBeenCalled();
  });
});

describe("warnUnboundCapabilities", () => {
  it("lists every skipped capability on stderr", () => {
    warnUnboundCapabilities(
      {
        kn_id: "kn1",
        capabilities: {
          bound: 1,
          skipped: [
            { capability_type: "skill", name: "盘点", reason: "not_found", detail: "no skill" },
            {
              capability_type: "function",
              name: "下单",
              box_name: "采购",
              reason: "ambiguous_name",
            },
          ],
        },
      },
      { declared: 3, skipped: [] },
    );
    expect(stderr()).toContain("2 declared capabilities were not bound");
    expect(stderr()).toContain("skill 盘点: not_found — no skill");
    expect(stderr()).toContain("function 采购 / 下单: ambiguous_name");
  });

  it("names a section the backend drops without a skip entry", () => {
    warnUnboundCapabilities(
      { kn_id: "kn1", capabilities: { bound: 0, skipped: [] } },
      { declared: 0, malformed: ".skills is not a list", skipped: [] },
    );
    expect(stderr()).toContain("capabilities .skills is not a list; none of it was bound");
  });

  it("stays quiet when everything was bound", () => {
    warnUnboundCapabilities(
      { capabilities: { bound: 2, skipped: [] } },
      { declared: 2, skipped: [] },
    );
    warnUnboundCapabilities({ id: "kn1" }, { declared: 0, skipped: [] });
    expect(process.stderr.write).not.toHaveBeenCalled();
  });
});
