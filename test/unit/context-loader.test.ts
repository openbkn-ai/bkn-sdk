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
  businessDomain: "bd_public",
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
        tenant_id: "tenant-1",
        business_domain_id: "bd_public",
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
