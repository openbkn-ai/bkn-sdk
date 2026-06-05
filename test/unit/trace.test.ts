import { afterEach, describe, expect, it, vi } from "vitest";
import { getSpansByConversation, traceSearch } from "../../src/api/trace.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

type CallArgs = [string, RequestInit];
function mockFetchSeq(bodies: unknown[]): typeof fetch {
  let i = 0;
  const fn = vi.fn(async () => {
    const body = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function calls(f: typeof fetch): CallArgs[] {
  return (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("traceSearch", () => {
  it("POSTs to the observability _search endpoint", async () => {
    const f = mockFetchSeq([{}]);
    await traceSearch(ctx, { query: {} });
    const c = calls(f)[0];
    if (!c) throw new Error("no call");
    expect(new URL(c[0]).pathname).toBe("/api/agent-observability/v1/traces/_search");
    expect(c[1].method).toBe("POST");
  });
});

describe("getSpansByConversation (two-hop)", () => {
  it("aggregates trace ids then fetches their spans", async () => {
    const f = mockFetchSeq([
      { aggregations: { tids: { buckets: [{ key: "t-1" }] } } },
      { hits: { hits: [{ _source: { traceId: "t-1", name: "span-a" } }] } },
    ]);
    const spans = await getSpansByConversation(ctx, "conv-1");
    expect(calls(f)).toHaveLength(2);
    expect(spans).toEqual([{ traceId: "t-1", name: "span-a" }]);
  });

  it("uses flat hits when no aggregations are returned", async () => {
    const f = mockFetchSeq([{ hits: { hits: [{ _source: { name: "flat" } }] } }]);
    const spans = await getSpansByConversation(ctx, "conv-1");
    expect(calls(f)).toHaveLength(1);
    expect(spans).toEqual([{ name: "flat" }]);
  });
});
