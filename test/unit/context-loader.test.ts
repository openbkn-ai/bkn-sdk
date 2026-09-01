// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.
import { ToolError } from "../../src/utils/errors.js";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callManagedTool,
  callMethod,
  callTool,
  getKnDetail,
  getObjectTypes,
  getRelationTypes,
} from "../../src/api/context-loader.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
  trace: {
    requestId: "req_context_loader_001",
    traceparent: "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
    conversationId: "conversation_supply_chain",
    interactionId: "interaction_june_forecast",
    operationId: "op_supplychain_schema_search",
    attempt: 1,
    observedAt: "2026-07-27T09:00:00.000Z",
  },
};

/** Mock the MCP endpoint: every POST returns a session id + a JSON-RPC result. */
function mockMcp(): typeof fetch {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] },
  });
  const fn = vi.fn(
    async () => new Response(body, { status: 200, headers: { "mcp-session-id": "s1" } }),
  );
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}

/**
 * The JSON-RPC POSTs, in order. Bodyless calls are skipped: a tool call is now
 * preceded by a GET probing the deploy's tool catalog for the lifecycle
 * contract.
 */
function rpcCalls(f: typeof fetch): Array<[Record<string, unknown>, RequestInit]> {
  const calls = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
  return calls
    .filter(([, init]) => typeof init?.body === "string")
    .map(([, init]) => [JSON.parse(init.body as string) as Record<string, unknown>, init]);
}

/** The `tools/call` request body among all the MCP POSTs (skips initialize etc.). */
function toolCallBody(f: typeof fetch): {
  name: string;
  arguments: Record<string, unknown>;
  _meta?: Record<string, unknown>;
} {
  for (const [body] of rpcCalls(f)) {
    const params = body.params as
      | { name: string; arguments: Record<string, unknown>; _meta?: Record<string, unknown> }
      | undefined;
    if (body.method === "tools/call" && params) return params;
  }
  throw new Error("no tools/call POST captured");
}

function toolCallHeaders(f: typeof fetch): Headers {
  for (const [body, init] of rpcCalls(f)) {
    if (body.method === "tools/call") return new Headers(init.headers);
  }
  throw new Error("no tools/call POST captured");
}

// A fresh kn per test avoids the module-level session cache masking the initialize POST.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("progressive KN detail (get_kn_detail)", () => {
  it("propagates the complete replay-stable business trace context to MCP calls", async () => {
    const f = mockMcp();
    await getKnDetail(ctx, "kn-trace-headers");

    const headers = toolCallHeaders(f);
    expect(headers.get("bkn-request-id")).toBe("req_context_loader_001");
    expect(headers.get("x-request-id")).toBe("req_context_loader_001");
    expect(headers.get("traceparent")).toBe(
      "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
    );
    expect(headers.get("bkn-conversation-id")).toBe("conversation_supply_chain");
    expect(headers.get("bkn-interaction-id")).toBe("interaction_june_forecast");
    expect(headers.get("bkn-operation-id")).toBe("op_supplychain_schema_search");
    expect(headers.get("bkn-attempt")).toBe("1");
    expect(headers.get("bkn-event-observed-at")).toBe("2026-07-27T09:00:00.000Z");
  });

  it("generates fresh operation context for each call on a long-lived client", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T09:00:00.000Z"));
    const f = mockMcp();
    const longLivedCtx = {
      ...ctx,
      trace: {
        requestId: ctx.trace?.requestId ?? "",
        traceparent: ctx.trace?.traceparent ?? "",
        conversationId: ctx.trace?.conversationId,
        interactionId: ctx.trace?.interactionId,
      },
    };

    await getKnDetail(longLivedCtx, "kn-long-lived-a");
    vi.setSystemTime(new Date("2026-07-27T09:01:00.000Z"));
    await getKnDetail(longLivedCtx, "kn-long-lived-b");

    const headers = rpcCalls(f)
      .filter(([body]) => body.method === "tools/call")
      .map(([, init]) => new Headers(init.headers));
    expect(headers).toHaveLength(2);
    expect(headers[0]?.get("bkn-operation-id")).not.toBe(headers[1]?.get("bkn-operation-id"));
    expect(headers[0]?.get("bkn-event-observed-at")).toBe("2026-07-27T09:00:00.000Z");
    expect(headers[1]?.get("bkn-event-observed-at")).toBe("2026-07-27T09:01:00.000Z");
  });

  it("defaults to no detail_level (server default = summary), asks for JSON", async () => {
    const f = mockMcp();
    await getKnDetail(ctx, "kn-a");
    const p = toolCallBody(f);
    expect(p.name).toBe("get_kn_detail");
    expect(p.arguments).toEqual({ response_format: "json" });
  });

  it("passes an explicit detail_level=full", async () => {
    const f = mockMcp();
    await getKnDetail(ctx, "kn-b", "full");
    expect(toolCallBody(f).arguments).toEqual({ detail_level: "full", response_format: "json" });
  });
});

describe("drill-down (get_object_types / get_relation_types)", () => {
  it("get_object_types sends ids as a JSON array", async () => {
    const f = mockMcp();
    await getObjectTypes(ctx, "kn-c", ["matches", "goals"]);
    const p = toolCallBody(f);
    expect(p.name).toBe("get_object_types");
    expect(p.arguments.ids).toEqual(["matches", "goals"]);
    expect(p.arguments.response_format).toBe("json");
  });

  it("get_relation_types sends ids as a JSON array", async () => {
    const f = mockMcp();
    await getRelationTypes(ctx, "kn-d", ["rel_a"]);
    const p = toolCallBody(f);
    expect(p.name).toBe("get_relation_types");
    expect(p.arguments.ids).toEqual(["rel_a"]);
  });
});

describe("managed MCP tool calls", () => {
  it("uses the automatic lifecycle path before retaining a receipt", async () => {
    const receipt = {
      receipt_id: "receipt-auto",
      conversation_id: "conv-auto",
      interaction_id: "int-auto",
      operation_id: "op-auto",
      receipt_status: "completed",
    };
    const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/mcp/info")) {
          return new Response(JSON.stringify({ tools: [{ name: "bkn_start_interaction" }] }));
        }
        const rpc = JSON.parse(init?.body as string) as {
          method?: string;
          params?: { name: string; arguments: Record<string, unknown> };
        };
        const headers = { "mcp-session-id": "auto-session" };
        if (rpc.method !== "tools/call" || !rpc.params) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), { headers });
        }
        calls.push(rpc.params);
        if (rpc.params.name === "bkn_start_interaction") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                content: [{ type: "text", text: "started" }],
                structuredContent: {
                  conversation_id: "conv-auto",
                  interaction_id: "int-auto",
                },
              },
            }),
            { headers },
          );
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: {
              content: [{ type: "text", text: JSON.stringify({ concepts: ["forecast"] }) }],
              structuredContent: { bkn_receipt: receipt },
            },
          }),
          { headers },
        );
      }),
    );

    await expect(
      callManagedTool(
        { baseUrl: "https://managed-auto.example.com", token: "receipt-token", insecure: false },
        "kn-auto-receipt",
        "search_schema",
        { query: "forecast" },
      ),
    ).resolves.toEqual({ value: { concepts: ["forecast"] }, receipt });
    expect(calls.map((call) => call.name)).toEqual(["bkn_start_interaction", "search_schema"]);
    expect(calls[1]?.arguments.bkn_context).toEqual({
      conversation_id: "conv-auto",
      interaction_id: "int-auto",
    });
  });

  it("accepts a replay receipt without a business value as null", async () => {
    const receipt = {
      receipt_id: "receipt-replay",
      conversation_id: "conversation_supply_chain",
      interaction_id: "interaction_june_forecast",
      operation_id: "operation-replay",
      receipt_status: "completed",
    };
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { structuredContent: { receipt } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(body, { status: 200, headers: { "mcp-session-id": "replay-s1" } }),
      ),
    );

    await expect(
      callManagedTool(ctx, "kn-replay", "search_schema", {
        query: "forecast",
        bkn_context: {
          conversation_id: "conversation_supply_chain",
          interaction_id: "interaction_june_forecast",
        },
      }),
    ).resolves.toEqual({ value: null, receipt });
  });

  it("does not reuse an MCP transport session across bearer identities", async () => {
    let initialized = 0;
    const businessSessions: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        const rpc = JSON.parse(init?.body as string) as { method?: string };
        if (rpc.method === "initialize") {
          initialized += 1;
          return new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
            headers: { "mcp-session-id": `identity-session-${initialized}` },
          });
        }
        if (rpc.method === "tools/call") {
          businessSessions.push(new Headers(init?.headers).get("mcp-session-id") ?? "");
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", result: { content: [] } }), {
          headers: { "mcp-session-id": `identity-session-${initialized}` },
        });
      }),
    );
    const base = { baseUrl: "https://identity-cache.example.com", insecure: false };
    await callTool({ ...base, token: "alice" }, "kn-identity-cache", "bkn_get_operation", {});
    await callTool({ ...base, token: "bob" }, "kn-identity-cache", "bkn_get_operation", {});

    expect(initialized).toBe(2);
    expect(businessSessions).toEqual(["identity-session-1", "identity-session-2"]);
  });

  it("rejects caller context that conflicts with trace business ids", async () => {
    const f = mockMcp();
    await expect(
      callTool(ctx, "kn-context-conflict", "search_schema", {
        query: "forecast",
        bkn_context: {
          conversation_id: "other-conversation",
          interaction_id: "other-interaction",
        },
      }),
    ).rejects.toThrow("Caller bkn_context conflicts with BKN Trace context.");
    expect(rpcCalls(f)).toHaveLength(0);
  });

  it("omits business trace headers when caller context is the only business source", async () => {
    const f = mockMcp();
    await callTool(
      {
        ...ctx,
        trace: {
          requestId: ctx.trace?.requestId ?? "",
          traceparent: ctx.trace?.traceparent ?? "",
        },
      },
      "kn-caller-context",
      "search_schema",
      {
        query: "forecast",
        bkn_context: {
          conversation_id: "conversation-caller",
          interaction_id: "interaction-caller",
        },
      },
    );
    const headers = toolCallHeaders(f);
    expect(headers.get("bkn-conversation-id")).toBeNull();
    expect(headers.get("bkn-interaction-id")).toBeNull();
  });

  it("preserves unsafe integers in tool arguments and text results", async () => {
    const body =
      '{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"id_card\\":110101199001152345}"}]}}';
    const fetchMock = vi.fn(
      async () => new Response(body, { status: 200, headers: { "mcp-session-id": "bigint-s1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callTool(ctx, "kn-bigint", "query_object_instance", { id_card: 110101199001152345n }),
    ).resolves.toEqual({
      id_card: 110101199001152345n,
    });

    const calls = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const toolCall = calls.find(([, init]) => String(init.body).includes("query_object_instance"));
    expect(toolCall?.[1].body).toContain("110101199001152345");
  });

  it("sends host lifecycle hints as MCP metadata, never as model tool arguments", async () => {
    const f = mockMcp();

    await callTool(
      ctx,
      "kn-host-hints",
      "bkn_start_interaction",
      { question: "查询供应链库存" },
      {
        hostConversationKey: "cursor-chat-42",
        clientInvocationId: "cursor-turn-7",
      },
    );

    const params = toolCallBody(f);
    expect(params.arguments).toEqual({ question: "查询供应链库存" });
    expect(params._meta).toEqual({
      "openbkn.ai/host-conversation-key": "cursor-chat-42",
      "openbkn.ai/client-invocation-id": "cursor-turn-7",
    });
  });

  it("omits MCP metadata when the host does not provide lifecycle hints", async () => {
    const f = mockMcp();

    await callTool(ctx, "kn-no-host-hints", "bkn_start_interaction", {
      question: "查询供应链库存",
    });

    expect(toolCallBody(f)._meta).toBeUndefined();
  });

  it("returns structured start output when the text content is descriptive", async () => {
    const interaction = {
      conversation_id: "conversation_supply_chain",
      interaction_id: "interaction_supply_chain",
      execution_status: "active",
    };
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "managed lifecycle state updated" }],
        structuredContent: interaction,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, { status: 200, headers: { "mcp-session-id": "lifecycle-s1" } }),
      ),
    );

    await expect(
      callTool(ctx, "kn-lifecycle", "bkn_start_interaction", {
        question: "查询供应链库存",
      }),
    ).resolves.toEqual(interaction);
  });

  it("rejects MCP tool errors instead of returning them as business values", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: "conversation_required: call bkn_start_interaction first",
          },
        ],
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(body, { status: 200, headers: { "mcp-session-id": "error-s1" } }),
      ),
    );

    await expect(
      callManagedTool(ctx, "kn-error", "search_schema", {
        query: "6月份需求预测",
      }),
    ).rejects.toThrow(
      "Context-loader error: conversation_required: call bkn_start_interaction first",
    );
  });

  it("raises a JSON-RPC error from callMethod as a refusal too", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: "invalid_params", message: "no such prompt" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200, headers: { "mcp-session-id": "m-s1" } })),
    );

    // Same shape as the tool path answers to; one module must not give two
    // answers for it.
    const err = await callMethod(ctx, "kn-error", "prompts/get").catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe("invalid_params");
  });

  it("raises a JSON-RPC error as a refusal, not as a transport failure", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: "conversation_required", message: "no such conversation" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(body, { status: 200, headers: { "mcp-session-id": "error-s2" } }),
      ),
    );

    // A gateway that validates arguments before dispatch answers here rather
    // than with an `isError` result. Callers deciding whether a failure is
    // about their arguments cannot tell the two apart if this is a plain Error.
    const err = await callManagedTool(ctx, "kn-error", "search_schema", { query: "q" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe("conversation_required");
  });

  it("rejects managed tool responses without a trusted operation receipt", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: JSON.stringify({ concepts: ["forecast"] }) }],
        structuredContent: {},
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, { status: 200, headers: { "mcp-session-id": "missing-receipt-s1" } }),
      ),
    );

    await expect(
      callManagedTool(ctx, "kn-managed", "search_schema", {
        query: "6月份需求预测",
      }),
    ).rejects.toThrow("Context-loader managed tool response did not include bkn_receipt");
  });

  it("returns the business value together with the trusted operation receipt", async () => {
    const receipt = {
      receipt_id: "receipt-1",
      schema_version: "3.0.0",
      conversation_id: "conversation_supply_chain",
      interaction_id: "interaction_june_forecast",
      operation_id: "operation-1",
      attempt: 1,
      operation_key: "search-schema",
      tool_name: "search_schema",
      receipt_status: "completed",
      evidence_durability: "pending",
      required: true,
      request_id: "request-1",
      trace_id: "1234567890abcdef1234567890abcdef",
      causation_event_ids: [],
      observed_evidence_refs: [],
      business_refs: [],
      artifact_refs: [],
      partial_reasons: [],
      row_version: 2,
      issued_at: "2026-08-02T06:00:00Z",
      owner: {
        application_principal_id: "openbkn-sdk",
        effective_subject_type: "user",
        effective_subject_id: "user-1",
      },
    };
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: JSON.stringify({ concepts: ["forecast"] }) }],
        structuredContent: { bkn_receipt: receipt },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, { status: 200, headers: { "mcp-session-id": "managed-s1" } }),
      ),
    );

    const result = await callManagedTool(ctx, "kn-managed", "search_schema", {
      query: "6月份需求预测",
      bkn_context: {
        conversation_id: "conversation_supply_chain",
        interaction_id: "interaction_june_forecast",
        operation_key: "search-schema",
      },
    });

    expect(result.value).toEqual({ concepts: ["forecast"] });
    expect(result.receipt).toEqual(receipt);
  });
});
