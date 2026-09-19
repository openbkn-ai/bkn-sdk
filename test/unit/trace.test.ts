import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSpansByConversation,
  getTechnicalTrace,
  getTraceGraph,
  listTechnicalTraces,
} from "../../src/api/trace.js";
import type { RawSpan } from "../../src/api/trace.js";
import { assembleTraceTree } from "../../src/bkn-trace/diagnose.js";
import { trace } from "../../src/resources/trace.js";
import type { RequestContext } from "../../src/types.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

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

describe("typed technical Trace APIs", () => {
  it("GETs the typed trace list with stable filters", async () => {
    const f = mockFetchSeq([{ entries: [], total: 0 }]);
    await listTechnicalTraces(ctx, {
      limit: 20,
      cursor: "c-1",
      from: "2026-08-01T00:00:00Z",
      to: "2026-08-09T00:00:00Z",
      status: "failed",
      service: "context-loader",
      tool: "run_sql",
      agentOrApp: "supply-chain-agent",
      traceId: "trace-1",
      keyword: "cypher",
      errorKeyword: "timeout",
      conversationId: "conv-1",
      interactionId: "int-1",
    });
    const c = calls(f)[0];
    if (!c) throw new Error("no call");
    const url = new URL(c[0]);
    expect(url.pathname).toBe("/api/agent-observability/v1/traces");
    expect(c[1].method).toBe("GET");
    // keyword and error_keyword are distinct server filters: never merged.
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: "20",
      cursor: "c-1",
      from: "2026-08-01T00:00:00Z",
      to: "2026-08-09T00:00:00Z",
      status: "failed",
      service: "context-loader",
      tool: "run_sql",
      agent_or_app: "supply-chain-agent",
      trace_id: "trace-1",
      keyword: "cypher",
      error_keyword: "timeout",
      conversation_id: "conv-1",
      interaction_id: "int-1",
    });
  });

  it("GETs one typed trace detail", async () => {
    const f = mockFetchSeq([
      {
        summary: { trace_id: "trace/1", request_id: "req-1", status: "completed" },
        operations: [],
        partial: false,
      },
    ]);

    const detail = await getTechnicalTrace(ctx, "trace/1");

    const c = calls(f)[0];
    if (!c) throw new Error("no call");
    expect(new URL(c[0]).pathname).toBe("/api/agent-observability/v1/traces/trace%2F1");
    expect(c[1].method).toBe("GET");
    expect(detail.summary?.trace_id).toBe("trace/1");
  });

  it("preserves unsafe nanosecond values in trace details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '{"summary":{"trace_id":"trace-1","request_id":"req-1","status":"completed"},"graph":{"trace_id":"trace-1","status":"completed","duration_nano":9223372036854775807,"partial":false,"partial_reason":[],"page":{"node_count":1,"edge_count":0},"data":{"nodes":[{"span_id":"span-1","name":"span","kind":"internal","status":"ok","start_nano":1786000000123456789,"end_nano":1786000000123456799,"duration_nano":9223372036854775807}],"edges":[]}},"operations":[],"partial":false}',
            { status: 200 },
          ),
      ),
    );

    const detail = await getTechnicalTrace(ctx, "trace-1");

    expect(detail.graph?.duration_nano).toBe(9223372036854775807n);
    expect(detail.graph?.data.nodes[0]).toMatchObject({
      start_nano: 1786000000123456789n,
      end_nano: 1786000000123456799n,
      duration_nano: 9223372036854775807n,
    });
  });

  it("rejects unknown list filters instead of silently returning an unfiltered page", async () => {
    const f = mockFetchSeq([]);

    expect(() =>
      listTechnicalTraces(ctx, { query: { term: { traceId: "trace-1" } } } as never),
    ).toThrow("Unknown technical Trace query field");
    expect(calls(f)).toHaveLength(0);
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

  it("reports unsupported diagnosis rules as skipped instead of applied", async () => {
    mockFetchSeq([
      { entries: [{ trace_id: "t-1", request_id: "req-1", status: "completed" }], total: 1 },
      {
        summary: { trace_id: "t-1", request_id: "req-1", status: "completed" },
        operations: [
          {
            fact: {
              operation_id: "op-1",
              attempt: 1,
              conversation_id: "conv-1",
              interaction_id: "int-1",
              tool_name: "run_sql",
              protocol: "mcp",
              source_module: "context-loader",
              input: {
                mode: "inline",
                media_type: "application/json",
                inline: { sql: "SELECT 1" },
              },
              started_at: "2026-08-09T10:00:00Z",
              finished_at: "2026-08-09T10:00:00.001Z",
              status: "completed",
              retryable: false,
            },
            receipt: {},
            state: "completed",
          },
        ],
        partial: false,
      },
    ]);

    const report = await trace(ctx).diagnose("conv-1");

    expect(report.rulesApplied).toEqual(["excessive_tool_calls_per_turn"]);
    expect(report.skippedRules).toEqual(
      expect.arrayContaining([
        "tool_loop_no_state_change",
        "tool_error_swallowed",
        "retrieval_empty_no_fallback",
        "llm_response_truncated_no_continue",
      ]),
    );
    expect(report.partial).toBe(true);
  });
});

describe("trace resource with sparse details", () => {
  it("diagnoses and scans a conversation whose detail omits summary and operations", async () => {
    mockFetchSeq([
      { entries: [{ trace_id: "t-1" }] },
      {
        graph: {
          trace_id: "t-1",
          data: { nodes: [{ span_id: "s-1", name: "a", kind: "CLIENT", status: "ok" }], edges: [] },
        },
      },
    ]);

    const report = await trace(ctx).diagnose("conv-1");
    expect(report.traceId).toBe("t-1");

    mockFetchSeq([{ entries: [{ trace_id: "t-1" }] }, { operations: [{ receipt: {} }] }]);
    const scan = await trace(ctx).scan(["conv-1"]);
    expect(scan.reports[0]).toEqual({
      conversationId: "conv-1",
      error: "No spans found for conversation: conv-1",
    });
  });
});

describe("typed BKN Trace graph APIs", () => {
  it("GETs trace graph by trace id", async () => {
    const f = mockFetchSeq([
      {
        summary: { trace_id: "trace_1", request_id: "req_1", status: "completed", span_count: 0 },
        graph: { trace_id: "trace_1", status: "ok", data: { nodes: [], edges: [] } },
        operations: [],
        partial: false,
      },
    ]);
    const result = await getTraceGraph(ctx, "trace_1");
    const c = calls(f)[0];
    if (!c) throw new Error("no call");
    expect(new URL(c[0]).pathname).toBe("/api/agent-observability/v1/traces/trace_1");
    expect(c[1].method).toBe("GET");
    expect(result.trace_id).toBe("trace_1");
  });
});

describe("getSpansByConversation (two-hop)", () => {
  it("lists typed traces then preserves operation input in normalized tool spans", async () => {
    const f = mockFetchSeq([
      { entries: [{ trace_id: "t-1", request_id: "req-1", status: "completed" }], total: 1 },
      {
        summary: { trace_id: "t-1", request_id: "req-1", status: "completed" },
        graph: {
          trace_id: "t-1",
          data: {
            nodes: [
              {
                span_id: "span-1",
                name: "span-a",
                kind: "CLIENT",
                status: "ok",
                start_nano: 10,
                end_nano: 20,
                duration_nano: 10,
              },
            ],
            edges: [],
          },
        },
        operations: [
          {
            fact: {
              operation_id: "op-1",
              attempt: 1,
              conversation_id: "conv-1",
              interaction_id: "int-1",
              tool_name: "run_sql",
              protocol: "mcp",
              source_module: "context-loader",
              input: {
                mode: "inline",
                media_type: "application/json",
                inline: { sql: "SELECT 1" },
              },
              trace_id: "t-1",
              span_id: "span-1",
              started_at: "2026-08-09T10:00:00Z",
              finished_at: "2026-08-09T10:00:00.001Z",
              status: "completed",
              retryable: false,
            },
            receipt: {},
            state: "completed",
          },
        ],
        partial: false,
      },
    ]);
    const spans = await getSpansByConversation(ctx, "conv-1");
    expect(calls(f)).toHaveLength(2);
    expect(new URL(calls(f)[0]?.[0] ?? "").searchParams.get("conversation_id")).toBe("conv-1");
    expect(new URL(calls(f)[1]?.[0] ?? "").pathname).toBe("/api/agent-observability/v1/traces/t-1");
    expect(spans).toEqual([
      {
        traceId: "t-1",
        spanId: "span-1",
        parentSpanId: "",
        name: "span-a",
        kind: "CLIENT",
        startTimeUnixNano: "10",
        endTimeUnixNano: "20",
        status: { code: "OK" },
        attributes: {
          "service.name": "",
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": "run_sql",
          "gen_ai.tool.args": { sql: "SELECT 1" },
          "bkn.operation.id": "op-1",
          "bkn.operation.attempt": 1,
          "bkn.operation.protocol": "mcp",
          "bkn.operation.source_module": "context-loader",
        },
      },
    ]);
    expect(assembleTraceTree("t-1", spans as unknown as RawSpan[]).byKind.get("tool")).toHaveLength(
      1,
    );
  });

  it("preserves realistic epoch nanoseconds and omits invalid values", async () => {
    const f = mockFetchSeq([
      { entries: [{ trace_id: "t-1", request_id: "req-1", status: "completed" }], total: 1 },
      {
        summary: { trace_id: "t-1", request_id: "req-1", status: "completed" },
        graph: {
          trace_id: "t-1",
          data: {
            nodes: [
              {
                span_id: "span-1",
                name: "span-a",
                kind: "CLIENT",
                status: "ok",
                start_nano: 1_786_000_000_123_456_800,
                end_nano: "1786000000123457000",
              },
            ],
            edges: [],
          },
        },
        operations: [],
        partial: true,
      },
    ]);

    const spans = await getSpansByConversation(ctx, "conv-1");

    expect(spans[0]).toMatchObject({
      startTimeUnixNano: "1786000000123456800",
      endTimeUnixNano: "1786000000123457000",
    });
  });

  it("preserves every operation attempt without duplicate span ids", async () => {
    const baseFact = {
      operation_id: "op-retry",
      conversation_id: "conv-1",
      interaction_id: "int-1",
      tool_name: "run_sql",
      protocol: "mcp",
      source_module: "context-loader",
      trace_id: "t-1",
      span_id: "span-shared",
      started_at: "2026-08-09T10:00:00Z",
      finished_at: "2026-08-09T10:00:00.001Z",
      retryable: true,
    };
    mockFetchSeq([
      { entries: [{ trace_id: "t-1", request_id: "req-1", status: "failed" }], total: 1 },
      {
        summary: { trace_id: "t-1", request_id: "req-1", status: "failed" },
        graph: {
          trace_id: "t-1",
          data: {
            nodes: [
              {
                span_id: "span-shared",
                name: "run_sql",
                kind: "CLIENT",
                status: "error",
                start_nano: 10,
                end_nano: 20,
                duration_nano: 10,
              },
            ],
            edges: [],
          },
        },
        operations: [
          {
            fact: {
              ...baseFact,
              attempt: 1,
              input: {
                mode: "inline",
                media_type: "application/json",
                inline: { sql: "SELECT 1" },
              },
              status: "failed",
            },
            receipt: {},
            state: "failed",
          },
          {
            fact: {
              ...baseFact,
              attempt: 2,
              input: {
                mode: "inline",
                media_type: "application/json",
                inline: { sql: "SELECT 2" },
              },
              status: "completed",
            },
            receipt: {},
            state: "completed",
          },
        ],
        partial: false,
      },
    ]);

    const spans = await getSpansByConversation(ctx, "conv-1");

    expect(new Set(spans.map((entry) => entry.spanId)).size).toBe(spans.length);
    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spanId: "op-retry:attempt:1",
          attributes: expect.objectContaining({
            "bkn.operation.attempt": 1,
            "gen_ai.tool.args": { sql: "SELECT 1" },
          }),
        }),
        expect.objectContaining({
          spanId: "op-retry:attempt:2",
          attributes: expect.objectContaining({
            "bkn.operation.attempt": 2,
            "gen_ai.tool.args": { sql: "SELECT 2" },
          }),
        }),
      ]),
    );
    const tree = assembleTraceTree("t-1", spans as unknown as RawSpan[]);
    expect(tree.spans.find((entry) => entry.spanId === "op-retry:attempt:1")?.status).toBe("error");
  });

  it("returns no spans when the typed trace list is empty", async () => {
    const f = mockFetchSeq([{ entries: [], total: 0 }]);
    const spans = await getSpansByConversation(ctx, "conv-1");
    expect(calls(f)).toHaveLength(1);
    expect(spans).toEqual([]);
  });

  it("pages through next_cursor with a page size clamped to 1..200", async () => {
    const f = mockFetchSeq([
      { entries: [{ trace_id: "t-1" }], next_cursor: "c-2", truncated: true },
      { entries: [{ trace_id: "t-2" }], truncated: false },
      {
        summary: { trace_id: "t-1" },
        operations: [],
        graph: {
          data: { nodes: [{ span_id: "s-1", name: "a", kind: "CLIENT", status: "ok" }], edges: [] },
        },
      },
      {
        summary: { trace_id: "t-2" },
        graph: {
          data: { nodes: [{ span_id: "s-2", name: "b", kind: "CLIENT", status: "ok" }], edges: [] },
        },
      },
    ]);

    const spans = await getSpansByConversation(ctx, "conv-1", { maxTraceIds: 500 });

    const urls = calls(f).map((c) => new URL(c[0]));
    expect(urls[0]?.searchParams.get("limit")).toBe("200");
    expect(urls[0]?.searchParams.has("cursor")).toBe(false);
    expect(urls[1]?.searchParams.get("cursor")).toBe("c-2");
    expect(urls[1]?.searchParams.get("limit")).toBe("200");
    expect(urls.slice(2).map((u) => u.pathname)).toEqual([
      "/api/agent-observability/v1/traces/t-1",
      "/api/agent-observability/v1/traces/t-2",
    ]);
    expect(spans.map((span) => span.spanId)).toEqual(["s-1", "s-2"]);
  });

  it("stops at maxTraceIds and never sends a limit below 1", async () => {
    const f = mockFetchSeq([
      { entries: [{ trace_id: "t-1" }, { trace_id: "t-2" }], next_cursor: "c-2" },
      { summary: { trace_id: "t-1" } },
    ]);

    await getSpansByConversation(ctx, "conv-1", { maxTraceIds: 0 });

    const urls = calls(f).map((c) => new URL(c[0]));
    expect(urls[0]?.searchParams.get("limit")).toBe("1");
    expect(urls.map((u) => u.pathname)).toEqual([
      "/api/agent-observability/v1/traces",
      "/api/agent-observability/v1/traces/t-1",
    ]);
  });

  it("stops following a cursor the server repeats", async () => {
    const f = mockFetchSeq([{ entries: [], next_cursor: "same" }]);

    await getSpansByConversation(ctx, "conv-1");

    expect(calls(f)).toHaveLength(2);
  });

  it("tolerates a detail with no summary, operations, receipt, or fact input", async () => {
    mockFetchSeq([
      { entries: [{ trace_id: "t-1" }] },
      {
        graph: {
          trace_id: "t-1",
          data: { nodes: [{ span_id: "s-1", name: "a", kind: "CLIENT", status: "ok" }], edges: [] },
        },
        operations: [
          { fact: { operation_id: "op-1", attempt: 1, tool_name: "run_sql", status: "failed" } },
          { state: "pending" },
        ],
      },
    ]);

    const spans = await getSpansByConversation(ctx, "conv-1");

    expect(spans.map((span) => [span.traceId, span.spanId])).toEqual([
      ["t-1", "s-1"],
      ["t-1", "op-1:attempt:1"],
    ]);
  });
});
