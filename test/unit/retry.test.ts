// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { authFetch } from "../../src/api/auth-fetch.js";
import { isReadFrame } from "../../src/api/context-loader.js";
import { request } from "../../src/api/http.js";
import { configureVersionCheck } from "../../src/api/version-check.js";
import { reportRetry } from "../../src/commands/_shared.js";
import type { RequestContext, RetryNotice } from "../../src/types.js";
import { HttpError } from "../../src/utils/errors.js";
import { verifiedContext } from "../setup/verified-context.js";

/** What undici throws for a socket-level failure: "fetch failed", the code on `.cause`. */
function netError(code: string): TypeError {
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error(`connect ${code}`), { code }),
  });
}

type Step = Response | Error;

/** Answer each fetch with the next step; the last one repeats. */
function platform(...steps: Step[]) {
  const fetch = vi.fn(async () => {
    const step = steps.length > 1 ? steps.shift() : steps[0];
    if (step instanceof Error) throw step;
    return (step as Response).clone();
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const ok = () => new Response('{"ok":true}', { status: 200 });
const status = (s: number, headers?: Record<string, string>) =>
  new Response('{"error":"x"}', { status: s, headers });

function retryCtx(over: Partial<RequestContext> = {}): RequestContext & { notices: RetryNotice[] } {
  const notices: RetryNotice[] = [];
  return Object.assign(
    verifiedContext<RequestContext>({
      baseUrl: "https://demo.example.com",
      token: "t",
      insecure: false,
      // No sleeping in tests; the policy is otherwise the default.
      retry: { baseDelayMs: 0 },
      onRetry: (n) => notices.push(n),
      ...over,
    }),
    { notices },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("transport retry", () => {
  it("rides out a gateway restart: refused connections, then an answer", async () => {
    const fetch = platform(netError("ECONNREFUSED"), netError("ECONNREFUSED"), ok());
    const c = retryCtx();
    await expect(request(c, "/api/x")).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(c.notices.map((n) => [n.method, n.reason, n.retry, n.retries])).toEqual([
      ["GET", "ECONNREFUSED", 1, 3],
      ["GET", "ECONNREFUSED", 2, 3],
    ]);
  });

  it("retries a read through each transient failure", async () => {
    const failures = [
      () => netError("ECONNRESET"),
      () => netError("ETIMEDOUT"),
      () => netError("EAI_AGAIN"),
      () => status(429),
      () => status(502),
      () => status(503),
      () => status(504),
    ];
    for (const failure of failures) {
      const fetch = platform(failure(), ok());
      await request(retryCtx(), "/api/x");
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it("never resends a write, whatever failed (docs/RELIABILITY.md)", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const failure of [() => netError("ECONNREFUSED"), () => status(503)]) {
        const fetch = platform(failure(), ok());
        await expect(request(retryCtx(), "/api/x", { method, body: {} })).rejects.toBeDefined();
        expect(fetch).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("counts a POST as a read when it says so", async () => {
    // The platform's own mark for a query sent as a POST.
    const override = platform(status(503), ok());
    await request(retryCtx(), "/api/x", {
      body: {},
      headers: { "X-HTTP-Method-Override": "GET" },
    });
    expect(override).toHaveBeenCalledTimes(2);

    // A search or dry-run its caller declares idempotent.
    const declared = platform(status(503), ok());
    await request(retryCtx(), "/api/x", { body: {}, idempotent: true });
    expect(declared).toHaveBeenCalledTimes(2);
  });

  it("leaves errors that will not change on retry alone", async () => {
    for (const s of [400, 404, 409, 500]) {
      const fetch = platform(status(s), ok());
      await expect(request(retryCtx(), "/api/x")).rejects.toMatchObject({ status: s });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
    const fetch = platform(netError("ENOTFOUND"), ok());
    await expect(request(retryCtx(), "/api/x")).rejects.toThrow("fetch failed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("gives up after three retries with the last answer", async () => {
    const fetch = platform(status(503));
    const err = await request(retryCtx(), "/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("waits as long as Retry-After asks, within the ceiling", async () => {
    platform(status(429, { "retry-after": "0" }), status(503, { "retry-after": "120" }), ok());
    const c = retryCtx({ retry: { baseDelayMs: 0, maxDelayMs: 5 } });
    await request(c, "/api/x");
    expect(c.notices.map((n) => n.delayMs)).toEqual([0, 5]);
  });

  it("does not sleep past the request's own timeout", async () => {
    const fetch = platform(status(503, { "retry-after": "10" }), ok());
    const err = await request(retryCtx({ retry: {} }), "/api/x", { timeoutMs: 2_000 }).catch(
      (e) => e,
    );
    expect((err as HttpError).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("is off with retry: false", async () => {
    const fetch = platform(netError("ECONNREFUSED"), ok());
    await expect(request(retryCtx({ retry: false }), "/api/x")).rejects.toThrow("fetch failed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends a direct fetch once unless it is marked a read", async () => {
    const c = retryCtx();
    const refusedOnce = () => {
      let n = 0;
      return vi.fn(async () => {
        n += 1;
        if (n === 1) throw netError("ECONNREFUSED");
        return ok();
      });
    };
    const upload = refusedOnce();
    await expect(authFetch(c, upload)).rejects.toThrow("fetch failed");
    expect(upload).toHaveBeenCalledTimes(1);

    const download = refusedOnce();
    await expect(authFetch(c, download, { method: "GET" })).resolves.toMatchObject({ status: 200 });
    expect(download).toHaveBeenCalledTimes(2);

    const search = refusedOnce();
    await expect(authFetch(c, search, { read: true })).resolves.toMatchObject({ status: 200 });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("retries the version preflight, which a restarting gateway meets first", async () => {
    const server = pkg.version.replace(/-.*$/, "");
    const fetch = vi.fn(async (input: string | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/bkn-backend/v1/health") {
        if (fetch.mock.calls.length === 1) throw netError("ECONNREFUSED");
        return new Response(JSON.stringify({ ServerVersion: server }), { status: 200 });
      }
      return ok();
    });
    vi.stubGlobal("fetch", fetch);
    const c: RequestContext = {
      baseUrl: "https://preflight.example.com",
      token: "t",
      insecure: false,
      retry: { baseDelayMs: 0 },
    };
    configureVersionCheck(c, "memory");
    await expect(request(c, "/api/x")).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3); // refused, health, business
  });
});

describe("MCP frames", () => {
  const call = (name: string) => ({ method: "tools/call", params: { name, arguments: {} } });

  it("resends read-only tools and the handshake", () => {
    for (const name of ["query_object_instance", "search_schema", "run_sql", "run_cypher"]) {
      expect(isReadFrame(call(name))).toBe(true);
    }
    expect(isReadFrame({ method: "initialize" })).toBe(true);
    expect(isReadFrame({ method: "tools/list" })).toBe(true);
  });

  it("sends tools that act, and tools it does not know, once", () => {
    for (const name of [
      "execute_action",
      "execute_tool",
      "run_code",
      "run_shell",
      "bkn_start_interaction",
      "bkn_finish_interaction",
      "some_new_tool",
    ]) {
      expect(isReadFrame(call(name))).toBe(false);
    }
  });
});

describe("retry notice", () => {
  it("names the route, the failure and the wait on stderr", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      reportRetry({
        method: "GET",
        url: "https://demo.example.com/api/trace/v1/traces?cursor=abc",
        reason: "HTTP 503",
        retry: 1,
        retries: 3,
        delayMs: 1_234,
      });
      expect(write).toHaveBeenCalledWith(
        "openbkn: GET /api/trace/v1/traces failed (HTTP 503); retry 1/3 in 1.2s\n",
      );
    } finally {
      write.mockRestore();
    }
  });
});
