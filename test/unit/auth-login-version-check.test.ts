// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/auth/oauth.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/auth/oauth.js")>();
  return {
    ...original,
    credentialDeviceLogin: vi.fn(),
    deviceLogin: vi.fn(),
    isHeadless: () => true,
  };
});

import { type OAuthTokens, credentialDeviceLogin, deviceLogin } from "../../src/auth/oauth.js";
import { authCommand } from "../../src/commands/auth.js";
import * as auth from "../../src/resources/auth.js";

const BASE = "https://login-version-check.example.com";
const previousConfigDir = process.env.BKN_CONFIG_DIR;
const previousUser = process.env.BKN_USER;
let configDir: string;

function health(version = "0.1.5") {
  return vi.fn(
    async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ServerVersion: version }), { status: 200 }),
  );
}

async function login(args: string[]): Promise<void> {
  await authCommand().parseAsync(["login", BASE, ...args], { from: "user" });
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "bkn-auth-login-version-"));
  process.env.BKN_CONFIG_DIR = configDir;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(configDir, { force: true, recursive: true });
  if (previousConfigDir === undefined) delete process.env.BKN_CONFIG_DIR;
  else process.env.BKN_CONFIG_DIR = previousConfigDir;
  if (previousUser === undefined) delete process.env.BKN_USER;
  else process.env.BKN_USER = previousUser;
});

describe("auth login platform-version preflight", () => {
  it("checks the platform with a supplied token before saving it", async () => {
    const fetch = health();
    vi.stubGlobal("fetch", fetch);

    await login(["--token", "direct-token"]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: "Bearer direct-token" },
    });
    expect(auth.status()).toMatchObject({ baseUrl: BASE, hasToken: true });
  });

  it("does not resolve BKN_USER before saving a first login", async () => {
    process.env.BKN_USER = "alice";
    vi.stubGlobal("fetch", health());

    await expect(login(["--token", "direct-token"])).resolves.toBeUndefined();

    expect(auth.status()).toMatchObject({ baseUrl: BASE, hasToken: true });
  });

  it.each([
    ["a version mismatch", () => new Response(JSON.stringify({ ServerVersion: "0.1.4" }))],
    ["a missing server version", () => new Response(JSON.stringify({ status: "ok" }))],
    ["an unreachable health endpoint", () => Promise.reject(new Error("connection refused"))],
  ])("does not save a supplied token after %s", async (_name, reply) => {
    vi.stubGlobal("fetch", vi.fn(reply));

    await expect(login(["--token", "direct-token"])).rejects.toThrow(/version/i);

    expect(auth.status()).toEqual({ hasToken: false });
  });

  it.each([
    ["password", ["-u", "alice", "-p", "secret"], credentialDeviceLogin],
    ["browser", ["--no-browser"], deviceLogin],
    ["device-code", ["--device"], deviceLogin],
  ])("checks before saving a %s login", async (_name, args, loginFlow) => {
    const fetch = health();
    vi.stubGlobal("fetch", fetch);
    vi.mocked(loginFlow).mockResolvedValue({ accessToken: `${_name}-token` } satisfies OAuthTokens);

    await login(args);

    expect(loginFlow).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/bkn-backend/v1/health"),
      expect.objectContaining({ headers: { authorization: `Bearer ${_name}-token` } }),
    );
    expect(auth.status()).toMatchObject({ baseUrl: BASE, hasToken: true });
  });
});
