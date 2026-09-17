// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, expect, it, vi } from "vitest";

const { readFileSync } = vi.hoisted(() => ({ readFileSync: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  readFileSync,
}));

import { readJsonArgs } from "../../src/commands/_shared.js";

afterEach(() => vi.clearAllMocks());

it("reads --args - from stdin", () => {
  readFileSync.mockReturnValue('{"ot_id":"ot-1","limit":10}');

  expect(readJsonArgs({ args: "-" })).toEqual({ ot_id: "ot-1", limit: 10 });
  expect(readFileSync).toHaveBeenCalledWith(0, "utf8");
});

it("names stdin when its argument stream cannot be read", () => {
  readFileSync.mockImplementation(() => {
    throw new Error("stream closed");
  });

  expect(() => readJsonArgs({ argsFile: "-" })).toThrow("Cannot read stdin: stream closed");
});
