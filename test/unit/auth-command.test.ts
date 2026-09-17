// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, expect, it, vi } from "vitest";
import { authCommand } from "../../src/commands/auth.js";

vi.mock("../../src/resources/auth.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/resources/auth.js")>();
  return {
    ...original,
    whoami: () => ({ baseUrl: "https://saved.example.com", username: "tester" }),
  };
});

const previousBaseUrl = process.env.BKN_BASE_URL;

afterEach(() => {
  if (previousBaseUrl === undefined) delete process.env.BKN_BASE_URL;
  else process.env.BKN_BASE_URL = previousBaseUrl;
  vi.restoreAllMocks();
});

it("warns about an env URL shadowing auth without printing embedded credentials", async () => {
  process.env.BKN_BASE_URL =
    "https://user:dummy-password@other.example.com/?token=dummy-query-token";
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await authCommand().parseAsync(["whoami", "--no-lookup"], { from: "user" });

  const warning = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
  expect(warning).toContain("BKN_BASE_URL is set to a different platform");
  expect(warning).not.toContain("dummy-password");
  expect(warning).not.toContain("dummy-query-token");
  expect(warning).not.toContain("other.example.com");
});
