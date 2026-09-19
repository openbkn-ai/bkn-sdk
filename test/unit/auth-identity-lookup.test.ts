// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, expect, it, vi } from "vitest";

const safe = vi.hoisted(() => ({
  getMeSafe: vi.fn(async () => ({ account: "alice", name: "Alice" })),
  getUserSafe: vi.fn(async () => ({ account: "admin-only" })),
}));

vi.mock("../../src/api/safe.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/api/safe.js")>();
  return { ...original, getMeSafe: safe.getMeSafe, getUserSafe: safe.getUserSafe };
});

vi.mock("../../src/resources/auth.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/resources/auth.js")>();
  return {
    ...original,
    whoami: () => ({ baseUrl: "https://saved.example.com", sub: "user-uuid" }),
    currentToken: () => "token",
    sessionInsecure: () => false,
  };
});

const { authCommand } = await import("../../src/commands/auth.js");

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it("whoami names the caller from the self-service /me read, never the admin-only user detail", async () => {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  await authCommand().parseAsync(["whoami"], { from: "user" });

  expect(safe.getMeSafe).toHaveBeenCalledTimes(1);
  expect(safe.getUserSafe).not.toHaveBeenCalled();
  const text = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
  expect(text).toContain("alice");
  expect(text).toContain("Alice");
});

it("whoami falls back to token claims when /me is unavailable", async () => {
  safe.getMeSafe.mockRejectedValueOnce(new Error("404"));
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  await authCommand().parseAsync(["whoami"], { from: "user" });

  expect(safe.getUserSafe).not.toHaveBeenCalled();
  expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("user-uuid");
});
