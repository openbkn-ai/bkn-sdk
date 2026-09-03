// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rawCall } from "../../src/api/call.js";
import { request } from "../../src/api/http.js";
import {
  VersionCompatibilityError,
  baseVersion,
  configureVersionCheck,
} from "../../src/api/version-check.js";
import { readVersionCheckCache, writeVersionCheckCache } from "../../src/config/store.js";
import type { RequestContext } from "../../src/types.js";

function ctx(
  mode: "memory" | "cli" = "memory",
  baseUrl = "https://demo.example.com",
): RequestContext {
  const context: RequestContext = {
    baseUrl,
    token: "token",
    insecure: false,
  };
  configureVersionCheck(context, mode);
  return context;
}

function route(version = "0.1.5", business = { ok: true }) {
  return vi.fn(async (input: string | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/bkn-backend/v1/health")
      return new Response(JSON.stringify({ ServerVersion: version }), { status: 200 });
    return new Response(JSON.stringify(business), { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("platform version preflight", () => {
  it("accepts a matching platform version and sends the business request", async () => {
    const fetch = route();
    vi.stubGlobal("fetch", fetch);

    await expect(request(ctx(), "/api/bkn-backend/v1/knowledge-networks")).resolves.toEqual({
      ok: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe("/api/bkn-backend/v1/health");
    expect(new URL(String(fetch.mock.calls[1]?.[0])).pathname).toBe(
      "/api/bkn-backend/v1/knowledge-networks",
    );
  });

  it("treats the SDK prerelease as compatible with its stable base version", async () => {
    expect(baseVersion("0.1.5-rc.1")).toBe("0.1.5");
    const fetch = route("0.1.5");
    vi.stubGlobal("fetch", fetch);

    await expect(request(ctx(), "/api/x")).resolves.toEqual({ ok: true });
  });

  it("reads ServerVersion from the standard response envelope", async () => {
    const fetch = vi.fn(async (input: string | URL) => {
      const body =
        new URL(String(input)).pathname === "/api/bkn-backend/v1/health"
          ? { data: { ServerVersion: "0.1.5" } }
          : { ok: true };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(request(ctx(), "/api/x")).resolves.toEqual({ ok: true });
  });

  it("blocks the business request on a version mismatch", async () => {
    const fetch = route("0.1.4");
    vi.stubGlobal("fetch", fetch);

    const error = await request(ctx(), "/api/x").catch((reason) => reason);
    expect(error).toBeInstanceOf(VersionCompatibilityError);
    expect((error as Error).message).toMatch(/SDK version 0\.1\.5-rc\.1.*platform version 0\.1\.4/);
    expect(fetch).toHaveBeenCalledOnce();
    expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe("/api/bkn-backend/v1/health");
  });

  it("blocks when health does not return a valid server version", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(request(ctx(), "/api/x")).rejects.toThrow(/did not return a valid ServerVersion/);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("checks a programmatic client only once", async () => {
    const fetch = route();
    vi.stubGlobal("fetch", fetch);
    const client = ctx();

    await request(client, "/api/one");
    await request(client, "/api/two");

    expect(fetch).toHaveBeenCalledTimes(3); // health once, then two business requests
  });

  it("also gates the raw call escape hatch", async () => {
    const fetch = route();
    vi.stubGlobal("fetch", fetch);

    await expect(rawCall(ctx(), "/api/x")).resolves.toMatchObject({ status: 200 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("initializes version state for a manually constructed public context", async () => {
    const fetch = route();
    vi.stubGlobal("fetch", fetch);
    const publicCtx: RequestContext = {
      baseUrl: "https://demo.example.com",
      token: "token",
      insecure: false,
    };

    await expect(request(publicCtx, "/api/x")).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects an absolute URL for another platform before checking or sending", async () => {
    const fetch = route();
    vi.stubGlobal("fetch", fetch);

    await expect(request(ctx(), "https://other.example.com/api/x")).rejects.toThrow(
      /differs from the configured platform/,
    );
    await expect(rawCall(ctx(), "https://other.example.com/api/x")).rejects.toThrow(
      /differs from the configured platform/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reuses a successful CLI check for 60 seconds across clients", async () => {
    const fetch = route();
    vi.stubGlobal("fetch", fetch);

    await request(ctx("cli"), "/api/one");
    await request(ctx("cli"), "/api/two");

    expect(fetch).toHaveBeenCalledTimes(3); // health once, then two business requests
    expect(readVersionCheckCache("https://demo.example.com")?.serverVersion).toBe("0.1.5");
  });

  it("rechecks the CLI version after its cache expires", async () => {
    writeVersionCheckCache("https://demo.example.com", {
      serverVersion: "0.1.5",
      checkedAt: new Date(Date.now() - 60_001).toISOString(),
    });
    const fetch = route();
    vi.stubGlobal("fetch", fetch);

    await request(ctx("cli"), "/api/x");

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("continues when the optional CLI cache cannot be written", async () => {
    const root = mkdtempSync(join(tmpdir(), "bkn-version-check-"));
    const blocked = join(root, "not-a-directory");
    writeFileSync(blocked, "blocked");
    const previous = process.env.BKN_CONFIG_DIR;
    process.env.BKN_CONFIG_DIR = blocked;
    const fetch = route();
    vi.stubGlobal("fetch", fetch);

    try {
      await expect(
        request(ctx("cli", "https://cache-write-fails.example.com"), "/api/x"),
      ).resolves.toEqual({
        ok: true,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      if (previous === undefined) delete process.env.BKN_CONFIG_DIR;
      else process.env.BKN_CONFIG_DIR = previous;
      rmSync(root, { force: true, recursive: true });
    }
  });
});
