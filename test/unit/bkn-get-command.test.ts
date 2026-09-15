// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn(async () => ({ id: "kn-a" })) }));

vi.mock("../../src/commands/_shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commands/_shared.js")>();
  return { ...actual, clientFrom: vi.fn(() => ({ kn: { get } })) };
});

import { bknCommand } from "../../src/commands/bkn.js";

function run(...argv: string[]): Promise<Command> {
  return new Command("openbkn")
    .exitOverride()
    .option("--json")
    .addCommand(bknCommand())
    .parseAsync(["node", "openbkn", "--json", "bkn", "get", "kn-a", ...argv]);
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("openbkn bkn get", () => {
  it("passes branch and detail level to the SDK", async () => {
    await run("--branch", "review", "--detail-level", "summary", "--export");
    expect(get).toHaveBeenCalledWith("kn-a", {
      stats: undefined,
      exportMode: true,
      branch: "review",
      detailLevel: "summary",
    });
  });

  it("rejects an invalid detail level before reading", async () => {
    await expect(run("--detail-level", "brief")).rejects.toThrow(
      "--detail-level must be full or summary",
    );
    expect(get).not.toHaveBeenCalled();
  });
});
