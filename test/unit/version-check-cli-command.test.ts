// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminCommand } from "../../src/commands/admin.js";
import { authCommand } from "../../src/commands/auth.js";
import { callCommand } from "../../src/commands/call.js";
import { writeVersionCheckCache } from "../../src/config/store.js";

const BASE = "https://cli-version-check.example.com";

function cli(): Command {
  const root = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <token>");
  root.addCommand(callCommand());
  root.addCommand(adminCommand());
  root.addCommand(authCommand());
  return root;
}

beforeEach(() => {
  writeVersionCheckCache(BASE, { serverVersion: "0.1.5", checkedAt: new Date().toISOString() });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("direct CLI commands use the version-check cache", () => {
  it.each([
    ["call", ["call", "/api/x"]],
    ["admin call", ["admin", "call", "/api/x"]],
    [
      "auth change-password",
      [
        "auth",
        "change-password",
        "--account",
        "admin",
        "--old-password",
        "old",
        "--new-password",
        "new",
      ],
    ],
  ])("uses the CLI cache for %s", async (_name, args) => {
    await cli().parseAsync(["--base-url", BASE, "--token", "token", ...args], { from: "user" });

    expect(fetch).toHaveBeenCalledOnce();
    expect(
      String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]),
    ).not.toContain("/api/bkn-backend/v1/health");
  });
});
