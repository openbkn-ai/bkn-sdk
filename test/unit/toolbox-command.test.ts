// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { expect, it } from "vitest";
import { buildProgram } from "../../src/cli-program.js";

it.each([
  ["--header", "[]"],
  ["--query", "null"],
  ["--path", "1"],
])("refuses non-object %s JSON before invoking a tool", async (flag, value) => {
  const error = await buildProgram()
    .parseAsync(
      [
        "--base-url",
        "https://toolbox.example.com",
        "--token",
        "t",
        "tool",
        "execute",
        "tool-1",
        "--toolbox",
        "box-1",
        flag,
        value,
      ],
      { from: "user" },
    )
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(`${flag} must be a JSON object`);
});
