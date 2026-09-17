// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RetryNotice, tlsFetch } from "../../src/api/tls.js";

const URL_ = "https://retry.example.com/api/x";

function netError(code: string): TypeError {
  const cause = Object.assign(new Error(`connect ${code} 10.0.0.1:443`), { code });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

/** Run a fetch with fake timers, draining every backoff sleep. */
async function run<T>(p: Promise<T>): Promise<T> {
  const settled = p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  await vi.runAllTimersAsync();
  const r = await settled;
  if (r.ok) return r.v;
  throw r.e;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tlsFetch transient retry", () => {
  it("retries a refused connection for any method, then succeeds", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(netError("ECONNREFUSED"))
      .mockRejectedValueOnce(netError("ECONNREFUSED"))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const notices: RetryNotice[] = [];

    const res = await run(
      tlsFetch({ insecure: false, onRetry: (n) => notices.push(n) }, URL_, {
        method: "POST",
        body: '{"a":1}',
      }),
    );

    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(notices.map((n) => [n.attempt, n.retries, n.delayMs, n.reason])).toEqual([
      [1, 3, 500, "ECONNREFUSED"],
      [2, 3, 1000, "ECONNREFUSED"],
    ]);
    expect(notices[0]).toMatchObject({ method: "POST", url: URL_ });
  });

  it("gives up after three retries and surfaces the last error", async () => {
    const fetch = vi.fn().mockRejectedValue(netError("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetch);

    await expect(run(tlsFetch(false, URL_))).rejects.toThrow("fetch failed");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("finds the code inside an AggregateError cause", async () => {
    const agg = Object.assign(new AggregateError([netError("ECONNREFUSED").cause]), {});
    const err = Object.assign(new TypeError("fetch failed"), { cause: agg });
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    expect((await run(tlsFetch(false, URL_, { method: "DELETE" }))).status).toBe(204);
  });

  it.each([
    ["GET", true],
    ["HEAD", true],
    ["POST", false],
    ["PUT", false],
  ])("retries a dropped connection only for idempotent reads: %s", async (method, retried) => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(netError("ECONNRESET"))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    const p = run(tlsFetch(false, URL_, { method }));
    if (retried) await expect(p).resolves.toBeInstanceOf(Response);
    else await expect(p).rejects.toThrow("fetch failed");
    expect(fetch).toHaveBeenCalledTimes(retried ? 2 : 1);
  });

  it.each([
    [502, "GET", 2],
    [503, "GET", 2],
    [503, "POST", 1],
    [429, "GET", 2],
    [429, "POST", 1],
    [504, "GET", 1],
    [500, "GET", 1],
  ])("HTTP %i on %s is sent %i time(s)", async (status, method, calls) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status }))
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await run(tlsFetch(false, URL_, { method }));
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  it.each(["ENOTFOUND", "DEPTH_ZERO_SELF_SIGNED_CERT"])("never retries %s", async (code) => {
    const fetch = vi.fn().mockRejectedValue(netError(code));
    vi.stubGlobal("fetch", fetch);

    await expect(run(tlsFetch(false, URL_))).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the transport turns it off", async () => {
    const fetch = vi.fn().mockRejectedValue(netError("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetch);

    await expect(run(tlsFetch({ insecure: false, retry: false }, URL_))).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry once the caller's signal has aborted", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      controller.abort();
      throw netError("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetch);

    await expect(run(tlsFetch(false, URL_, { signal: controller.signal }))).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops sleeping when the caller's deadline passes mid-backoff", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 700);
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      throw netError("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetch);

    const started = Date.now();
    await expect(run(tlsFetch(false, URL_, { signal: controller.signal }))).rejects.toThrow();
    // t=0 refused, t=500 refused, then the 1 s sleep is cut short at t=700.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("treats ETIMEDOUT as ambiguous: reads retry, writes do not", async () => {
    const fetch = vi.fn().mockRejectedValue(netError("ETIMEDOUT"));
    vi.stubGlobal("fetch", fetch);
    await expect(run(tlsFetch(false, URL_, { method: "POST" }))).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["3", 3000, 2],
    ["0", 500, 2],
    ["60", undefined, 1],
  ])("honours Retry-After %s within a cap", async (header, delayMs, calls) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("busy", { status: 503, headers: { "retry-after": header } }),
      )
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const notices: RetryNotice[] = [];

    const res = await run(tlsFetch({ onRetry: (n) => notices.push(n) }, URL_));

    expect(fetch).toHaveBeenCalledTimes(calls);
    if (delayMs === undefined) {
      expect(res.status).toBe(503);
      expect(notices).toEqual([]);
    } else {
      expect(notices[0]?.delayMs).toBe(delayMs);
    }
  });

  it("does not retry a body that cannot be sent twice", async () => {
    const fetch = vi.fn().mockRejectedValue(netError("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetch);

    await expect(
      run(tlsFetch(false, URL_, { method: "POST", body: new ReadableStream() })),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
