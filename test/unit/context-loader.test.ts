// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, describe, expect, it, vi } from "vitest";
import { getKnDetail, getObjectTypes, getRelationTypes } from "../../src/api/context-loader.js";
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

/** The `tools/call` request body among all the MCP POSTs (skips initialize etc.). */
function toolCallBody(f: typeof fetch): { name: string; arguments: Record<string, unknown> } {
  const calls = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
  for (const [, init] of calls) {
    const b = JSON.parse(init.body as string) as {
      method?: string;
      params?: { name: string; arguments: Record<string, unknown> };
    };
    if (b.method === "tools/call" && b.params) return b.params;
  }
  throw new Error("no tools/call POST captured");
}

function toolCallHeaders(f: typeof fetch): Headers {
  const calls = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
  for (const [, init] of calls) {
    const body = JSON.parse(init.body as string) as { method?: string };
    if (body.method === "tools/call") return new Headers(init.headers);
  }
  throw new Error("no tools/call POST captured");
}

// A fresh kn per test avoids the module-level session cache masking the initialize POST.
afterEach(() => vi.unstubAllGlobals());

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
