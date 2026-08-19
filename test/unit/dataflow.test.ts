import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDataflowLogs,
  listDataflowRuns,
  listDataflows,
  pingDataflows,
} from "../../src/api/dataflow.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

type CallArgs = [string, RequestInit];
function mockFetch(): typeof fetch {
  const fn = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function url(fetchMock: typeof fetch): URL {
  const args = (fetchMock as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!args) throw new Error("fetch not called");
  return new URL(args[0]);
}
afterEach(() => vi.unstubAllGlobals());

describe("dataflow read endpoints (automation v2)", () => {
  it("list hits /dags with data-flow filter", async () => {
    const f = mockFetch();
    await listDataflows(ctx);
    const u = url(f);
    expect(u.pathname).toBe("/api/automation/v2/dags");
    expect(u.searchParams.get("type")).toBe("data-flow");
    expect(u.searchParams.get("limit")).toBe("-1");
  });

  it("ping keeps the default deadline, so a gateway can still answer 504", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_i: string, init: RequestInit = {}) => {
          signal = init.signal ?? undefined;
          // Never settles: the point is what happens while the request is open.
          return new Promise<Response>(() => {});
        }),
      );
      void pingDataflows(ctx);
      await Promise.resolve();
      // A hung upstream yields 504 only once the gateway's own read timeout
      // elapses. Giving up before then would abort with nothing to report, and
      // the preflight reading 504 as absence would never see one.
      vi.advanceTimersByTime(20_000);
      expect(signal?.aborted).toBe(false);
      vi.advanceTimersByTime(11_000);
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ping asks for one row, not the whole listing", async () => {
    const f = mockFetch();
    await pingDataflows(ctx);
    const u = url(f);
    expect(u.pathname).toBe("/api/automation/v2/dags");
    // A gateway timeout on the full listing would as easily mean "slow query"
    // as "nobody answered"; callers reading 504 as absence need the bounded ask.
    expect(u.searchParams.get("limit")).toBe("1");
  });

  it("runs hits /dag/{id}/results", async () => {
    const f = mockFetch();
    await listDataflowRuns(ctx, "dag 1");
    const u = url(f);
    expect(u.pathname).toBe("/api/automation/v2/dag/dag%201/results");
    // No explicit limit/page → backend defaults (limit=20, page=0) apply.
    expect(u.searchParams.has("limit")).toBe(false);
    expect(u.searchParams.has("page")).toBe(false);
  });

  it("runs drops a NaN limit (never sends limit=NaN)", async () => {
    const f = mockFetch();
    await listDataflowRuns(ctx, "d1", { limit: Number.NaN });
    expect(url(f).searchParams.has("limit")).toBe(false);
  });

  it("runs forwards page/limit to page past the default 20", async () => {
    const f = mockFetch();
    await listDataflowRuns(ctx, "d1", { page: 2, limit: 100 });
    const u = url(f);
    expect(u.searchParams.get("page")).toBe("2");
    expect(u.searchParams.get("limit")).toBe("100");
  });

  it("logs hits /dag/{id}/result/{instance} with paging", async () => {
    const f = mockFetch();
    await getDataflowLogs(ctx, "d1", "i1", { page: 2, limit: 10 });
    const u = url(f);
    expect(u.pathname).toBe("/api/automation/v2/dag/d1/result/i1");
    expect(u.searchParams.get("page")).toBe("2");
    expect(u.searchParams.get("limit")).toBe("10");
  });
});
