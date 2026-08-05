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
        return new Response(JSON.stringify(opts.catalog ?? V2_CATALOG), { status: 200 });
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
        } else if (rpc.params.arguments.conversation_id) {
          // v1: the conversation already exists, so only the interaction is new.
          interactionSeq += 1;
          structuredContent = { interaction_id: `int_${interactionSeq}`, lease_epoch: 1 };
        } else {
          // v2: one call mints both ids.
          conversationSeq += 1;
          interactionSeq += 1;
          structuredContent = {
            conversation_id: `conv_${conversationSeq}`,
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

beforeEach(() => resetLifecycleCaches());
afterEach(() => vi.unstubAllGlobals());

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
    expect(recorded.toolCalls[0]?.arguments).toEqual({ question: "物料" });

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
    expect(recorded.toolCalls[1]?.arguments).toEqual({ question: "物料" });
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
