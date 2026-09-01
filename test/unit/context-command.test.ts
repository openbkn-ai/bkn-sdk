// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { contextCommand } from "../../src/commands/context.js";

function program(json = false): Command {
  return new Command("openbkn").exitOverride().option("--json").option("--compact").addCommand(contextCommand());
}

describe("openbkn context tool-call receipt output", () => {
  it("rejects --receipt without --json before calling the deploy", async () => {
    await expect(
      program().parseAsync([
        "node",
        "openbkn",
        "context",
        "tool-call",
        "kn-a",
        "search_schema",
        "--receipt",
      ]),
    ).rejects.toThrow("--receipt requires --json");
  });

  it("rejects --receipt with --schema", async () => {
    await expect(
      program(true).parseAsync([
        "node",
        "openbkn",
        "--json",
        "context",
        "tool-call",
        "kn-a",
        "search_schema",
        "--receipt",
        "--schema",
      ]),
    ).rejects.toThrow("--receipt cannot be combined with --schema");
  });
});
