// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runCypher, cypher } = vi.hoisted(() => ({
  runCypher: vi.fn(async () => ({ columns: [], entries: [] })),
  cypher: vi.fn(async () => ({ columns: [], entries: [] })),
}));

vi.mock("../../src/commands/_shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commands/_shared.js")>();
  return {
    ...actual,
    clientFrom: vi.fn(() => ({ context: { runCypher }, kn: { cypher } })),
  };
});

import { bknCommand } from "../../src/commands/bkn.js";
import { contextCommand } from "../../src/commands/context.js";

function program(): Command {
  return new Command("openbkn")
    .exitOverride()
    .option("--json")
    .option("--compact")
    .addCommand(contextCommand())
    .addCommand(bknCommand());
}

function run(...argv: string[]): Promise<Command> {
  return program().parseAsync(["node", "openbkn", "--json", ...argv]);
}

// The commands print their answer; keep it out of the test output.
beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(process.stdout.write).mockRestore();
});

const QUERY = "MATCH (o:order) WHERE o.id = $id RETURN o.no AS no";

describe("openbkn context run-cypher", () => {
  it("passes the query, branch and parameters, keeping big integers exact", async () => {
    await run(
      "context",
      "run-cypher",
      "kn-a",
      "--query",
      QUERY,
      "--branch",
      "dev",
      "--params",
      '{"id": 9007199254740993}',
    );
    expect(runCypher).toHaveBeenCalledWith("kn-a", QUERY, {
      branch: "dev",
      parameters: { id: 9007199254740993n },
    });
  });

  it("requires --query unless --schema was asked for, before calling the deploy", async () => {
    await expect(run("context", "run-cypher", "kn-a")).rejects.toThrow("--query is required");
    expect(runCypher).not.toHaveBeenCalled();
  });

  it("refuses --params that is not a JSON object, before calling the deploy", async () => {
    await expect(
      run("context", "run-cypher", "kn-a", "--query", QUERY, "--params", "[1, 2]"),
    ).rejects.toThrow("--params must be a JSON object");
    await expect(
      run("context", "run-cypher", "kn-a", "--query", QUERY, "--params", "{not json"),
    ).rejects.toThrow("--params is not valid JSON");
    expect(runCypher).not.toHaveBeenCalled();
  });
});

describe("openbkn bkn cypher", () => {
  it("sends the query straight to bkn-backend with branch and parameters", async () => {
    await run("bkn", "cypher", "kn-a", "--query", QUERY, "--params", '{"id": 7}');
    expect(cypher).toHaveBeenCalledWith("kn-a", QUERY, {
      branch: undefined,
      parameters: { id: 7 },
    });
  });

  it("refuses an empty query before calling the deploy", async () => {
    await expect(run("bkn", "cypher", "kn-a", "--query", "   ")).rejects.toThrow(
      "--query must not be empty",
    );
    expect(cypher).not.toHaveBeenCalled();
  });
});
