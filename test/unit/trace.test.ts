import { afterEach, describe, expect, it, vi } from "vitest";
import { emitEvidenceEvents, getSpansByConversation, traceSearch } from "../../src/api/trace.js";
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

describe("emitEvidenceEvents", () => {
  it("POSTs a phase-two evidence event batch", async () => {
    const f = mockFetchSeq([
      {
        trace_id: "8c0d0000000000000000000000000001",
        "bkn.request.id": "req_phase2_001",
        "bkn.trace.schema.version": "2.0.0",
        accepted_event_count: 1,
        claim_count: 1,
        evidence_ref_count: 0,
        business_ref_count: 0,
      },
    ]);
    const result = await emitEvidenceEvents(ctx, {
      "bkn.trace.schema.version": "2.0.0",
      trace: {
        trace_id: "8c0d0000000000000000000000000001",
        traceparent: "00-8c0d0000000000000000000000000001-1f12000000000001-01",
        "bkn.request.id": "req_phase2_001",
        business_domain: "bd_demo",
        "bkn.account.id": "acct_demo",
        "bkn.account.type": "app",
      },
      events: [
        {
          event_id: "evt_claim",
          event_type: "claim.created",
          "bkn.trace.schema.version": "2.0.0",
          observed_at: "2026-07-22T04:00:00.000000000Z",
          emitted_at: "2026-07-22T04:00:00.001000000Z",
          producer_module: "third-party-agent",
          trace_id: "8c0d0000000000000000000000000001",
          span_id: "1f12000000000001",
          "bkn.request.id": "req_phase2_001",
          "bkn.operation.name": "agent.answer",
          payload: {
            claim_id: "claim_001",
            claim_type: "answer",
            claim_hash: "sha256:claim",
            visibility: "visible",
            version_status: "versioned",
          },
        },
      ],
    });

    const c = calls(f)[0];
    if (!c) throw new Error("no call");
    expect(new URL(c[0]).pathname).toBe("/api/agent-observability/v1/evidence/events");
    expect(c[1].method).toBe("POST");
    expect(JSON.parse(c[1].body as string).events[0].event_type).toBe("claim.created");
    expect(result.accepted_event_count).toBe(1);
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
