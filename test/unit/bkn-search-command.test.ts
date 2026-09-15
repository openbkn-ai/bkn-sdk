// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { expect, it } from "vitest";
import { buildProgram } from "../../src/cli-program.js";
import { DryRunSignal, enableDryRun } from "../../src/utils/dry-run.js";

async function preview(args: string[]): Promise<DryRunSignal> {
  enableDryRun();
  const result = await buildProgram()
    .parseAsync(
      ["--base-url", "https://search.example.com", "--token", "t", "--dry-run", ...args],
      { from: "user" },
    )
    .catch((error: unknown) => error);
  expect(result).toBeInstanceOf(DryRunSignal);
  return result as DryRunSignal;
}

it("accepts a search query beginning with a minus sign", async () => {
  const signal = await preview(["bkn", "search", "kn-1", "-40℃ and 85℃"]);

  expect(signal.request.body).toMatchObject({
    kn_id: "kn-1",
    query: "-40℃ and 85℃",
  });
});

it("still parses known search options after a minus-prefixed query", async () => {
  const signal = await preview([
    "bkn",
    "search",
    "kn-1",
    "-40℃ and 85℃",
    "--max-object-types",
    "40",
  ]);

  expect(signal.request.body).toMatchObject({
    query: "-40℃ and 85℃",
    max_object_types: 40,
  });
});
