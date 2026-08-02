import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitEvidenceArtifact,
  emitEvidenceEvents,
  getBusinessGraph,
  getEvidenceArtifact,
  getEvidenceChain,
  getInteractionSummary,
  getRequestSummary,
  getRequestTraces,
  getSnapshotPreview,
  getSpansByConversation,
  getTraceGraph,
  listRequestSummaries,
  traceSearch,
} from "../../src/api/trace.js";
import { trace } from "../../src/resources/trace.js";
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

describe("BKN Trace 2.2 business runs and artifacts", () => {
  it("sends the dedicated ingest token only to evidence write endpoints", async () => {
    const ingestCtx = {
      ...ctx,
      evidenceIngestToken: "producer-ingest-token",
    } as RequestContext;
    const artifact = {
      artifact_id: "art_auth_001",
      artifact_type: "question" as const,
      "bkn.request.id": "req_auth_001",
      trace_id: "11111111111111111111111111111111",
      content_type: "application/json",
      schema_version: "2.2.0" as const,
      observed_at: "2026-07-27T09:00:00Z",
      content_hash: `sha256:${"1".repeat(64)}`,
      content: "test",
      business_domain: "bd_public",
      "bkn.account.id": "account_1",
      "bkn.account.type": "app",
    };
    const f = mockFetchSeq([{ artifact_id: artifact.artifact_id, created: true }, artifact]);

    await emitEvidenceArtifact(ingestCtx, artifact);
    await getEvidenceArtifact(ingestCtx, artifact.artifact_id);

    const [writeCall, readCall] = calls(f);
    if (!writeCall || !readCall) throw new Error("missing calls");
    expect(new Headers(writeCall[1].headers).get("x-bkn-trace-ingest-token")).toBe(
      "producer-ingest-token",
    );
    expect(writeCall[1].redirect).toBe("manual");
    expect(new Headers(readCall[1].headers).get("x-bkn-trace-ingest-token")).toBeNull();
    expect(readCall[1].redirect).toBeUndefined();
  });

  it("writes an artifact and reads it back through authorized endpoints", async () => {
    const artifact = {
      artifact_id: "art_question_001",
      artifact_type: "question" as const,
      "bkn.request.id": "req_business_001",
      trace_id: "11111111111111111111111111111111",
      content_type: "application/json",
      schema_version: "2.2.0" as const,
      observed_at: "2026-07-27T09:00:00Z",
      content_hash: `sha256:${"1".repeat(64)}`,
      content: "客户 A 的风险为什么上升？",
      business_domain: "customer-risk",
      "bkn.account.id": "account_1",
      "bkn.account.type": "app",
    };
    const f = mockFetchSeq([{ artifact_id: artifact.artifact_id, created: true }, artifact]);

    await emitEvidenceArtifact(ctx, artifact);
    const loaded = await getEvidenceArtifact(ctx, artifact.artifact_id);

    const [writeCall, readCall] = calls(f);
    if (!writeCall || !readCall) throw new Error("missing calls");
    expect(new URL(writeCall[0]).pathname).toBe("/api/agent-observability/v1/evidence/artifacts");
    expect(writeCall[1].method).toBe("POST");
    expect(new URL(readCall[0]).pathname).toBe(
      "/api/agent-observability/v1/evidence/artifacts/art_question_001",
    );
    expect(loaded.content).toBe("客户 A 的风险为什么上升？");
  });

  it("lists business requests and follows request-to-trace links", async () => {
    const f = mockFetchSeq([
      {
        entries: [
          {
            request_id: "req_business_001",
            status: "completed",
            evidence_completeness: "complete",
            action_summary: {},
            trace_count: 1,
          },
        ],
        total: 1,
      },
      {
        request_id: "req_business_001",
        status: "completed",
        evidence_completeness: "complete",
        action_summary: {},
        trace_count: 1,
      },
      {
        entries: [
          {
            trace_id: "trace_001",
            request_id: "req_business_001",
            status: "completed",
            span_count: 7,
          },
        ],
        total: 1,
      },
    ]);

    const page = await listRequestSummaries(ctx, {
      evidenceCompleteness: "complete",
      keyword: "客户 A",
      knowledgeNetwork: "customer-risk-network",
      limit: 30,
      status: "completed",
    });
    const summary = await getRequestSummary(ctx, "req_business_001");
    const traces = await getRequestTraces(ctx, "req_business_001", { limit: 30 });

    const [listCall, summaryCall, tracesCall] = calls(f);
    if (!listCall || !summaryCall || !tracesCall) throw new Error("missing calls");
    const listURL = new URL(listCall[0]);
    expect(listURL.pathname).toBe("/api/agent-observability/v1/business-provenance/requests");
    expect(listURL.searchParams.get("keyword")).toBe("客户 A");
    expect(listURL.searchParams.get("status")).toBe("completed");
    expect(listURL.searchParams.get("knowledge_network")).toBe("customer-risk-network");
    expect(listURL.searchParams.get("evidence_completeness")).toBe("complete");
    expect(new URL(summaryCall[0]).pathname).toBe(
      "/api/agent-observability/v1/business-provenance/requests/req_business_001",
    );
    expect(new URL(tracesCall[0]).pathname).toBe(
      "/api/agent-observability/v1/business-provenance/requests/req_business_001/traces",
    );
    expect(page.entries[0]?.request_id).toBe("req_business_001");
    expect(summary.request_id).toBe("req_business_001");
    expect(traces.entries[0]?.request_id).toBe("req_business_001");
  });

  it("reads an interaction aggregate and filters requests by lifecycle ids", async () => {
    const f = mockFetchSeq([
      {
        entries: [],
        total: 0,
      },
      {
        interaction_id: "interaction_june_forecast",
        conversation_id: "conversation_supply_chain",
        status: "completed",
        requests: [
          {
            request_id: "req_schema",
            conversation_id: "conversation_supply_chain",
            interaction_id: "interaction_june_forecast",
            status: "completed",
            evidence_completeness: "complete",
            action_summary: {},
            trace_count: 1,
          },
        ],
        traces: [
          {
            trace_id: "trace_schema",
            request_id: "req_schema",
            conversation_id: "conversation_supply_chain",
            interaction_id: "interaction_june_forecast",
            status: "completed",
            span_count: 4,
          },
        ],
      },
    ]);

    await listRequestSummaries(ctx, {
      conversationId: "conversation_supply_chain",
      interactionId: "interaction_june_forecast",
    });
    const interaction = await getInteractionSummary(ctx, "interaction_june_forecast");

    const [listCall, interactionCall] = calls(f);
    if (!listCall || !interactionCall) throw new Error("missing calls");
    const listURL = new URL(listCall[0]);
    expect(listURL.searchParams.get("conversation_id")).toBe("conversation_supply_chain");
    expect(listURL.searchParams.get("interaction_id")).toBe("interaction_june_forecast");
    expect(new URL(interactionCall[0]).pathname).toBe(
      "/api/agent-observability/v1/business-provenance/interactions/interaction_june_forecast",
    );
    expect(interaction.conversation_id).toBe("conversation_supply_chain");
    expect(interaction.requests[0]?.interaction_id).toBe("interaction_june_forecast");
    expect(interaction.traces[0]?.conversation_id).toBe("conversation_supply_chain");
  });
});

describe("trace Community resource", () => {
  it("exposes the 3.0 lifecycle API and managed interaction wrapper", () => {
    const resource = trace(ctx);

    expect(resource.lifecycle.ensureConversation).toBeTypeOf("function");
    expect(resource.lifecycle.getReceipt).toBeTypeOf("function");
    expect(resource.withInteraction).toBeTypeOf("function");
  });

  it("does not distribute the legacy 2.x evidence writer through the Community resource", () => {
    const resource = trace(ctx);

    expect("createSession" in resource).toBe(false);
    expect("emitEvidenceEvents" in resource).toBe(false);
    expect("requests" in resource).toBe(false);
    expect("interactions" in resource).toBe(false);
  });
});

describe("typed BKN Trace graph APIs", () => {
  it("GETs trace graph by trace id", async () => {
    const f = mockFetchSeq([{ trace_id: "trace_1", status: "ok", data: { nodes: [], edges: [] } }]);
    const result = await getTraceGraph(ctx, "trace_1");
    const c = calls(f)[0];
    if (!c) throw new Error("no call");
    expect(new URL(c[0]).pathname).toBe("/api/agent-observability/v1/traces/trace_1/trace-graph");
    expect(c[1].method).toBe("GET");
    expect(result.trace_id).toBe("trace_1");
  });

  it("GETs evidence chain and business graph with optional limit", async () => {
    const f = mockFetchSeq([
      { trace_id: "trace_1", data: { claims: [], evidence_refs: [], business_refs: [] } },
      { trace_id: "trace_1", data: { nodes: [], edges: [] } },
    ]);
    await getEvidenceChain(ctx, "trace_1", { limit: 50 });
    await getBusinessGraph(ctx, "trace_1", { limit: 50 });
    const [evidenceCall, graphCall] = calls(f);
    if (!evidenceCall || !graphCall) throw new Error("missing calls");
    const evidenceURL = new URL(evidenceCall[0]);
    const graphURL = new URL(graphCall[0]);
    expect(evidenceURL.pathname).toBe("/api/agent-observability/v1/traces/trace_1/evidence-chain");
    expect(evidenceURL.searchParams.get("limit")).toBe("50");
    expect(graphURL.pathname).toBe("/api/agent-observability/v1/traces/trace_1/business-graph");
    expect(graphURL.searchParams.get("limit")).toBe("50");
  });

  it("GETs request scoped evidence chain and snapshot preview", async () => {
    const f = mockFetchSeq([
      { "bkn.request.id": "req_1", data: { claims: [], evidence_refs: [], business_refs: [] } },
      { "bkn.request.id": "req_1", data: { nodes: [], edges: [] } },
      { "bkn.request.id": "req_1", snapshot_ref: { mode: "preview" }, manifest: {} },
    ]);
    await getEvidenceChain(ctx, { requestId: "req_1" });
    await getBusinessGraph(ctx, { requestId: "req_1" });
    await getSnapshotPreview(ctx, { requestId: "req_1" });
    const [evidenceCall, graphCall, snapshotCall] = calls(f);
    if (!evidenceCall || !graphCall || !snapshotCall) throw new Error("missing calls");
    const evidenceURL = new URL(evidenceCall[0]);
    const graphURL = new URL(graphCall[0]);
    const snapshotURL = new URL(snapshotCall[0]);
    expect(evidenceURL.pathname).toBe("/api/agent-observability/v1/traces/by-request");
    expect(evidenceURL.searchParams.get("request_id")).toBe("req_1");
    expect(graphURL.pathname).toBe("/api/agent-observability/v1/traces/by-request/business-graph");
    expect(graphURL.searchParams.get("request_id")).toBe("req_1");
    expect(snapshotURL.pathname).toBe(
      "/api/agent-observability/v1/traces/by-request/snapshot-preview",
    );
    expect(snapshotURL.searchParams.get("request_id")).toBe("req_1");
  });

  it("does not serialize a NaN limit", async () => {
    const f = mockFetchSeq([
      { trace_id: "trace_1", data: { claims: [], evidence_refs: [], business_refs: [] } },
    ]);

    await getEvidenceChain(ctx, "trace_1", { limit: Number.NaN });

    const c = calls(f)[0];
    if (!c) throw new Error("no call");
    expect(new URL(c[0]).searchParams.has("limit")).toBe(false);
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
