// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, searchSchema } from "../../src/api/context-loader.js";
import { semanticSearch } from "../../src/api/knowledge-networks.js";
import { releaseLifecycleSessions, resetLifecycleCaches } from "../../src/api/lifecycle.js";
import type { RequestContext } from "../../src/types.js";
import { HttpError, ToolError } from "../../src/utils/errors.js";

const V1_CATALOG = {
  tools: [{ name: "bkn_create_conversation" }, { name: "bkn_start_interaction" }],
};
const V2_CATALOG = {
  tools: [{ name: "bkn_start_interaction" }, { name: "bkn_finish_interaction" }],
};
const LEGACY_CATALOG = { tools: [{ name: "search_schema" }] };

/** A fresh host per test: both the lifecycle and MCP session caches key on it. */
let hostSeq = 0;
function freshCtx(extra: Partial<RequestContext> = {}): RequestContext {
  hostSeq += 1;
  return {
    baseUrl: `https://deploy-${hostSeq}.example.com`,
    token: "t",
    businessDomain: "bd_public",
    insecure: false,
    ...extra,
  };
}

interface MockOptions {
  catalog?: unknown;
  /** Server replies for the retrieval POST, in order; a string body means an error. */
  retrieval?: Array<{ status: number; body: unknown }>;
}

interface Recorded {
  retrievalBodies: Array<Record<string, unknown>>;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  infoCount: number;
}

function mockDeploy(opts: MockOptions = {}): Recorded {
  const recorded: Recorded = { retrievalBodies: [], toolCalls: [], infoCount: 0 };
  const catalog = opts.catalog ?? V2_CATALOG;
  const isV1 = JSON.stringify(catalog).includes("bkn_create_conversation");
  const retrieval = opts.retrieval ?? [{ status: 200, body: { concepts: [] } }];
  let retrievalIndex = 0;
  let conversationSeq = 0;
  let interactionSeq = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/mcp/info")) {
        recorded.infoCount += 1;
        return new Response(JSON.stringify(catalog), { status: 200 });
      }

      if (url.endsWith("/v1/mcp")) {
        const rpc = JSON.parse(init?.body as string) as {
          method?: string;
          params?: { name: string; arguments: Record<string, unknown> };
        };
        const headers = { "mcp-session-id": "mcp-session" };
        if (rpc.method !== "tools/call" || !rpc.params) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
            status: 200,
            headers,
          });
        }
        recorded.toolCalls.push(rpc.params);
        let structuredContent: Record<string, unknown>;
        if (!rpc.params.name.startsWith("bkn_")) {
          // A business tool answers with its payload as JSON text.
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result: { content: [{ type: "text", text: JSON.stringify({ object_types: [] }) }] },
            }),
            { status: 200, headers },
          );
        }
        if (rpc.params.name === "bkn_create_conversation") {
          conversationSeq += 1;
          structuredContent = { conversation_id: `conv_${conversationSeq}`, one_shot: true };
        } else if (rpc.params.name === "bkn_finish_interaction") {
          structuredContent = { execution_status: "canceled" };
        } else if (isV1) {
          // v1 starts an interaction inside a conversation that already exists.
          interactionSeq += 1;
          structuredContent = { interaction_id: `int_${interactionSeq}`, lease_epoch: 1 };
        } else {
          // v2 mints both ids in one call, unless the caller named a conversation.
          const named = rpc.params.arguments.conversation_id;
          if (typeof named !== "string") conversationSeq += 1;
          interactionSeq += 1;
          structuredContent = {
            conversation_id: typeof named === "string" ? named : `conv_${conversationSeq}`,
            interaction_id: `int_${interactionSeq}`,
            execution_status: "active",
          };
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: {
              content: [{ type: "text", text: "managed lifecycle state updated" }],
              structuredContent,
            },
          }),
          { status: 200, headers },
        );
      }

      if (url.includes("/kn/semantic-search")) {
        recorded.retrievalBodies.push(JSON.parse(init?.body as string));
        const reply = retrieval[Math.min(retrievalIndex, retrieval.length - 1)] ?? {
          status: 200,
          body: {},
        };
        retrievalIndex += 1;
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      }

      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  return recorded;
}

/** The body of the most recent `/kn/semantic-search` POST. */
function lastRetrievalBody(f: typeof fetch): Record<string, unknown> {
  const calls = (f as unknown as { mock: { calls: [string | URL, RequestInit][] } }).mock.calls;
  const hit = calls.filter(([url]) => String(url).includes("/kn/semantic-search")).pop();
  if (!hit) throw new Error("no retrieval POST captured");
  return JSON.parse(hit[1].body as string) as Record<string, unknown>;
}

beforeEach(() => resetLifecycleCaches());
afterEach(() => {
  vi.unstubAllGlobals();
  // Restored here rather than at the end of the test that installs them: a
  // failing assertion would otherwise leak fake timers into every later case,
  // turning one failure into a cascade.
  vi.useRealTimers();
});

describe("managed lifecycle on semantic search", () => {
  it("omits bkn_context on a deploy without the lifecycle tools", async () => {
    const recorded = mockDeploy({ catalog: LEGACY_CATALOG });
    await semanticSearch(freshCtx(), "kn-legacy", "物料");

    expect(recorded.toolCalls).toHaveLength(0);
    expect(recorded.retrievalBodies[0]).not.toHaveProperty("bkn_context");
    expect(recorded.retrievalBodies[0]?.query).toBe("物料");
  });

  it("omits bkn_context when the catalog probe fails", async () => {
    const recorded = mockDeploy({ catalog: { unexpected: "shape" } });
    await semanticSearch(freshCtx(), "kn-odd", "物料");

    expect(recorded.retrievalBodies[0]).not.toHaveProperty("bkn_context");
  });

  it("v1: creates a conversation, starts an interaction, and sends an operation_key", async () => {
    const recorded = mockDeploy({ catalog: V1_CATALOG });
    await semanticSearch(freshCtx(), "kn-managed", "物料");

    expect(recorded.toolCalls.map((c) => c.name)).toEqual([
      "bkn_create_conversation",
      "bkn_start_interaction",
    ]);
    expect(recorded.toolCalls[0]?.arguments.one_shot).toBe(true);
    expect(recorded.toolCalls[0]?.arguments.external_conversation_key).toMatch(/^cli:/);
    // The question is the user's query, so the recorded evidence is meaningful.
    expect(recorded.toolCalls[1]?.arguments.question).toBe("物料");

    const context = recorded.retrievalBodies[0]?.bkn_context as Record<string, string>;
    expect(context.conversation_id).toBe("conv_1");
    expect(context.interaction_id).toBe("int_1");
    expect(context.operation_key).toMatch(/^op:/);
  });

  it("v2: mints both ids in one call and omits operation_key", async () => {
    const recorded = mockDeploy({ catalog: V2_CATALOG });
    await semanticSearch(freshCtx(), "kn-managed", "物料");

    expect(recorded.toolCalls.map((c) => c.name)).toEqual(["bkn_start_interaction"]);
    expect(recorded.toolCalls[0]?.arguments).toEqual({
      question: "物料",
      agent_name: "openbkn-sdk",
    });

    const context = recorded.retrievalBodies[0]?.bkn_context as Record<string, string>;
    expect(context.conversation_id).toBe("conv_1");
    expect(context.interaction_id).toBe("int_1");
    // v2 validates bkn_context strictly: an extra field is invalid_business_context.
    expect(context).not.toHaveProperty("operation_key");
    expect(Object.keys(context).sort()).toEqual(["conversation_id", "interaction_id"]);
  });

  it("v1: reuses one session across calls but never reuses an operation_key", async () => {
    const recorded = mockDeploy({ catalog: V1_CATALOG });
    const ctx = freshCtx();
    await semanticSearch(ctx, "kn-managed", "物料");
    await semanticSearch(ctx, "kn-managed", "供应商");

    // A replayed operation_key returns the receipt instead of the payload, so
    // the second search would come back empty.
    const first = recorded.retrievalBodies[0]?.bkn_context as Record<string, string>;
    const second = recorded.retrievalBodies[1]?.bkn_context as Record<string, string>;
    expect(second.operation_key).not.toBe(first.operation_key);
    expect(second.conversation_id).toBe(first.conversation_id);
    expect(recorded.toolCalls).toHaveLength(2);
    expect(recorded.infoCount).toBe(1);
  });

  it("v2: reuses one session and probes the catalog once", async () => {
    const recorded = mockDeploy({ catalog: V2_CATALOG });
    const ctx = freshCtx();
    await semanticSearch(ctx, "kn-managed", "物料");
    await semanticSearch(ctx, "kn-managed", "供应商");

    expect(recorded.toolCalls).toHaveLength(1);
    expect(recorded.infoCount).toBe(1);
  });

  it("prefers a caller-owned conversation and opens nothing", async () => {
    const recorded = mockDeploy({ catalog: V1_CATALOG });
    const ctx = freshCtx({
      trace: {
        requestId: "req_1",
        traceparent: "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
        conversationId: "conv_caller_owned",
        interactionId: "int_caller_owned",
      },
    });
    await semanticSearch(ctx, "kn-managed", "物料");

    expect(recorded.toolCalls).toHaveLength(0);
    const context = recorded.retrievalBodies[0]?.bkn_context as Record<string, string>;
    expect(context.conversation_id).toBe("conv_caller_owned");
    expect(context.interaction_id).toBe("int_caller_owned");
    expect(context.operation_key).toMatch(/^op:/);
  });

  it("opens an interaction inside a conversation the caller named on its own", async () => {
    const recorded = mockDeploy();
    const ctx = freshCtx({
      trace: {
        requestId: "req_1",
        traceparent: "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
        conversationId: "conv_caller_named",
      },
    });
    await semanticSearch(ctx, "kn-managed", "物料");

    // Opening a fresh conversation would file the evidence somewhere the caller
    // never asked for, silently.
    // Exact match: the name is fixed at creation, so joining must not relabel
    // someone else's conversation.
    expect(recorded.toolCalls[0]?.arguments).toEqual({
      question: "物料",
      conversation_id: "conv_caller_named",
    });
    const context = recorded.retrievalBodies[0]?.bkn_context as Record<string, string>;
    expect(context.conversation_id).toBe("conv_caller_named");
    expect(context.interaction_id).toBe("int_1");
  });

  it("keeps one session per KN rather than reusing another KN's conversation", async () => {
    const recorded = mockDeploy();
    const ctx = freshCtx();
    await semanticSearch(ctx, "kn-alpha", "物料");
    await semanticSearch(ctx, "kn-beta", "物料");

    // The conversation is opened over an MCP session bound to `x-kn-id`.
    const alpha = recorded.retrievalBodies[0]?.bkn_context as Record<string, string>;
    const beta = recorded.retrievalBodies[1]?.bkn_context as Record<string, string>;
    expect(beta.conversation_id).not.toBe(alpha.conversation_id);
    expect(recorded.toolCalls).toHaveLength(2);
  });

  it("keeps one session per named conversation rather than reusing the first", async () => {
    const recorded = mockDeploy();
    const host = `https://named-${hostSeq}.example.com`;
    const trace = {
      requestId: "req_1",
      traceparent: "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
    };
    const a: RequestContext = {
      ...freshCtx(),
      baseUrl: host,
      trace: { ...trace, conversationId: "conv_A" },
    };
    const b: RequestContext = {
      ...freshCtx(),
      baseUrl: host,
      trace: { ...trace, conversationId: "conv_B" },
    };
    await semanticSearch(a, "kn-1", "物料");
    await semanticSearch(b, "kn-1", "供应商");

    // A caller who named conv_B must not silently get an interaction on conv_A,
    // nor have it released on their behalf at exit.
    expect(
      (recorded.retrievalBodies[0]?.bkn_context as Record<string, string>).conversation_id,
    ).toBe("conv_A");
    expect(
      (recorded.retrievalBodies[1]?.bkn_context as Record<string, string>).conversation_id,
    ).toBe("conv_B");
  });

  it("re-probes the catalog after a probe failure instead of failing closed forever", async () => {
    let probes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/mcp/info")) {
          probes += 1;
          // One blip, then the deploy answers normally.
          if (probes === 1) return new Response("gateway", { status: 502 });
          return new Response(JSON.stringify(V2_CATALOG), { status: 200 });
        }
        if (url.endsWith("/v1/mcp")) {
          const rpc = JSON.parse(init?.body as string) as { method?: string };
          const headers = { "mcp-session-id": "s" };
          if (rpc.method !== "tools/call") {
            return new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
              status: 200,
              headers,
            });
          }
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                content: [{ type: "text", text: "managed lifecycle state updated" }],
                structuredContent: { conversation_id: "conv_1", interaction_id: "int_1" },
              },
            }),
            { status: 200, headers },
          );
        }
        return new Response(JSON.stringify({ concepts: [] }), { status: 200 });
      }),
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00.000Z"));
    const ctx = freshCtx();

    await semanticSearch(ctx, "kn-1", "物料");
    // Inside the failure window the probe is not repeated: a durably missing
    // catalog would otherwise cost a doomed round trip on every business call.
    await semanticSearch(ctx, "kn-1", "供应商");
    expect(probes).toBe(1);

    vi.setSystemTime(new Date("2026-08-05T00:01:00.000Z"));
    await semanticSearch(ctx, "kn-1", "订单");
    // And past it, the deploy gets another chance — caching the failure for
    // good would leave a long-lived process sending no bkn_context for the
    // rest of its life, with no path back.
    expect(probes).toBe(2);
  });

  it("keeps one session per caller rather than sharing across tokens", async () => {
    const recorded = mockDeploy();
    const host = `https://shared-${Date.now()}.example.com`;
    const alice: RequestContext = { ...freshCtx(), baseUrl: host, token: "alice" };
    const bob: RequestContext = { ...freshCtx(), baseUrl: host, token: "bob" };
    await semanticSearch(alice, "kn-managed", "物料");
    await semanticSearch(bob, "kn-managed", "物料");

    // Sharing would file Bob's evidence under Alice's turn, and release it with
    // her credential.
    const first = recorded.retrievalBodies[0]?.bkn_context as Record<string, string>;
    const second = recorded.retrievalBodies[1]?.bkn_context as Record<string, string>;
    expect(second.conversation_id).not.toBe(first.conversation_id);
  });

  it("does not let one caller's rejected token silence the deploy for everyone", async () => {
    let probes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/mcp/info")) {
          probes += 1;
          const auth = new Headers(init?.headers).get("authorization");
          // Only Alice's credential is stale.
          if (auth?.includes("stale")) {
            return new Response(JSON.stringify({ error: "expired" }), { status: 401 });
          }
          return new Response(JSON.stringify(V2_CATALOG), { status: 200 });
        }
        if (url.endsWith("/v1/mcp")) {
          const rpc = JSON.parse(init?.body as string) as { method?: string };
          const headers = { "mcp-session-id": "s" };
          if (rpc.method !== "tools/call") {
            return new Response(JSON.stringify({ jsonrpc: "2.0", result: {} }), {
              status: 200,
              headers,
            });
          }
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                content: [{ type: "text", text: "managed lifecycle state updated" }],
                structuredContent: { conversation_id: "conv_1", interaction_id: "int_1" },
              },
            }),
            { status: 200, headers },
          );
        }
        return new Response(JSON.stringify({ concepts: [] }), { status: 200 });
      }),
    );

    const host = `https://tenants-${hostSeq}.example.com`;
    const alice: RequestContext = { ...freshCtx(), baseUrl: host, token: "stale" };
    const bob: RequestContext = { ...freshCtx(), baseUrl: host, token: "good" };
    await semanticSearch(alice, "kn-1", "物料");
    const bobBody = await semanticSearch(bob, "kn-1", "物料").then(() =>
      lastRetrievalBody(fetch as unknown as typeof fetch),
    );

    // A 401 is a fact about one identity. Filing it under the host would make
    // every other tenant on it look like a deploy with no lifecycle at all.
    expect(bobBody).toHaveProperty("bkn_context");
    expect(probes).toBe(2);
  });

  it("sends a caller-built bkn_context as-is and opens no session", async () => {
    const recorded = mockDeploy({ catalog: V1_CATALOG });
    const owned = {
      conversation_id: "conv_owned",
      interaction_id: "int_owned",
      operation_key: "op:pre-registered",
    };
    await semanticSearch(freshCtx(), "kn-managed", "物料", { bknContext: owned });

    // The same escape hatch context.toolCall has: a pre-registered
    // operation_key must reach the server unchanged.
    expect(recorded.toolCalls).toHaveLength(0);
    expect(recorded.retrievalBodies[0]?.bkn_context).toEqual(owned);
  });

  it("reopens the session once when the interaction has died, then retries", async () => {
    const recorded = mockDeploy({
      retrieval: [
        {
          status: 400,
          body: { error: { code: "interaction_terminal", required_action: "start_interaction" } },
        },
        { status: 200, body: { concepts: [{ id: "material" }] } },
      ],
    });
    const result = (await semanticSearch(freshCtx(), "kn-managed", "物料")) as {
      concepts: unknown[];
    };

    expect(result.concepts).toHaveLength(1);
    expect(recorded.retrievalBodies).toHaveLength(2);
    const retried = recorded.retrievalBodies[1]?.bkn_context as Record<string, string>;
    expect(retried.conversation_id).toBe("conv_2");
    expect(retried.interaction_id).toBe("int_2");
    // A v2 reopen must not carry the old conversation forward: a conversation
    // whose interaction is still active rejects the replacement.
    // The reopen mints a fresh conversation rather than reusing the dead one.
    expect(recorded.toolCalls[1]?.arguments).toEqual({
      question: "物料",
      agent_name: "openbkn-sdk",
    });
  });

  it("releases a v2 interaction so the conversation does not linger", async () => {
    const recorded = mockDeploy({ catalog: V2_CATALOG });
    const ctx = freshCtx();
    await semanticSearch(ctx, "kn-managed", "物料");
    await releaseLifecycleSessions();

    const finish = recorded.toolCalls.at(-1);
    expect(finish?.name).toBe("bkn_finish_interaction");
    // `completed` demands an answer artifact a CLI invocation does not have.
    expect(finish?.arguments.outcome).toBe("cancelled");
    expect(finish?.arguments.interaction_id).toBe("int_1");
  });

  it("leaves a v1 interaction to the idle sweeper rather than mis-closing it", async () => {
    const recorded = mockDeploy({ catalog: V1_CATALOG });
    const ctx = freshCtx();
    await semanticSearch(ctx, "kn-managed", "物料");
    await releaseLifecycleSessions();

    expect(recorded.toolCalls.map((c) => c.name)).not.toContain("bkn_finish_interaction");
  });

  it("releasing without a session is a no-op", async () => {
    const recorded = mockDeploy({ catalog: V2_CATALOG });
    await releaseLifecycleSessions();

    expect(recorded.toolCalls).toHaveLength(0);
  });

  it("never replaces a caller-owned conversation on a stale-session error", async () => {
    const recorded = mockDeploy({
      retrieval: [
        {
          status: 400,
          body: { error: { code: "interaction_terminal", required_action: "start_interaction" } },
        },
      ],
    });
    const ctx = freshCtx({
      trace: {
        requestId: "req_1",
        traceparent: "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
        conversationId: "conv_caller_owned",
        interactionId: "int_caller_owned",
      },
    });

    await expect(semanticSearch(ctx, "kn-managed", "物料")).rejects.toBeInstanceOf(HttpError);
    expect(recorded.retrievalBodies).toHaveLength(1);
    expect(recorded.toolCalls).toHaveLength(0);
  });

  it("does not retry an error that is not about the session", async () => {
    const recorded = mockDeploy({
      retrieval: [{ status: 400, body: { error: { code: "kn_not_found" } } }],
    });

    await expect(semanticSearch(freshCtx(), "kn-missing", "物料")).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(recorded.retrievalBodies).toHaveLength(1);
  });
});

describe("managed lifecycle on MCP business tools", () => {
  it("attaches bkn_context to a business tool and records the user's query", async () => {
    const recorded = mockDeploy({ catalog: V2_CATALOG });
    await searchSchema(freshCtx(), "kn-managed", "物料");

    expect(recorded.toolCalls.map((c) => c.name)).toEqual([
      "bkn_start_interaction",
      "search_schema",
    ]);
    expect(recorded.toolCalls[0]?.arguments.question).toBe("物料");
    expect(recorded.toolCalls[1]?.arguments.bkn_context).toEqual({
      conversation_id: "conv_1",
      interaction_id: "int_1",
    });
  });

  it("passes a caller-built bkn_context through untouched and opens no session", async () => {
    const recorded = mockDeploy({ catalog: V1_CATALOG });
    const owned = {
      conversation_id: "conv_owned",
      interaction_id: "int_owned",
      operation_key: "op:pre-registered",
      parent_operation_id: "op_parent",
      causation_event_ids: ["ev_1"],
    };
    await callTool(freshCtx(), "kn-managed", "search_schema", {
      query: "物料",
      bkn_context: owned,
    });

    // `ManagedTrace.runOperation` pre-registers an Operation under this exact
    // key before the tool call; replacing it would orphan the registration.
    expect(recorded.toolCalls.map((c) => c.name)).toEqual(["search_schema"]);
    expect(recorded.toolCalls[0]?.arguments.bkn_context).toEqual(owned);
  });

  it("leaves a business tool untouched on a deploy without the contract", async () => {
    const recorded = mockDeploy({ catalog: LEGACY_CATALOG });
    await searchSchema(freshCtx(), "kn-legacy", "物料");

    expect(recorded.toolCalls.map((c) => c.name)).toEqual(["search_schema"]);
    expect(recorded.toolCalls[0]?.arguments).not.toHaveProperty("bkn_context");
  });

  it("does not wrap a lifecycle tool in a session of its own", async () => {
    const recorded = mockDeploy({ catalog: V2_CATALOG });
    await callTool(freshCtx(), "kn-managed", "bkn_start_interaction", { question: "probe" });

    expect(recorded.toolCalls).toHaveLength(1);
    expect(recorded.toolCalls[0]?.arguments).not.toHaveProperty("bkn_context");
  });
});

describe("MCP results that carry structuredContent", () => {
  it("returns the structured payload when the text is prose", async () => {
    mockDeploy();
    const result = (await callTool(freshCtx(), "kn-managed", "bkn_create_conversation", {
      external_conversation_key: "cli:test",
    })) as { conversation_id: string };

    expect(result.conversation_id).toBe("conv_1");
  });

  it("throws on a tool-level error instead of returning it as data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              result: {
                content: [{ type: "text", text: "interaction_in_progress: ..." }],
                isError: true,
                structuredContent: {
                  error: {
                    code: "interaction_in_progress",
                    message: "the conversation already has an active interaction",
                  },
                },
              },
            }),
            { status: 200, headers: { "mcp-session-id": "mcp-session" } },
          ),
      ),
    );

    const thrown = await callTool(freshCtx(), "kn-managed", "bkn_start_interaction", {}).catch(
      (err: unknown) => err,
    );
    expect(thrown).toBeInstanceOf(ToolError);
    // The code, not the prose, is what decides whether a session can be reopened.
    expect((thrown as ToolError).code).toBe("interaction_in_progress");
  });
});
