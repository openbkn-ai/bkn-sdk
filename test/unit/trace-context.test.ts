import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHeaders } from "../../src/api/headers.js";
import { traceOptionsFrom } from "../../src/commands/_shared.js";
import { resolveContext } from "../../src/config/resolve.js";
import { createOperationTraceContext } from "../../src/trace-context.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "SECRET",
  insecure: false,
  trace: {
    requestId: "req_test_001",
    traceparent: "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
    baggage: {
      "bkn.account.type": "app",
      "bkn.account.id": "forbidden",
      "bkn.runtime.env": "test",
    },
  },
};

describe("BKN Trace context headers", () => {
  it("injects request id and traceparent while filtering forbidden baggage", () => {
    const headers = buildHeaders(ctx);
    expect(headers["bkn-request-id"]).toBe("req_test_001");
    expect(headers.traceparent).toBe("00-1234567890abcdef1234567890abcdef-1234567890abcdef-01");
    expect(headers.baggage).toBe("bkn.account.type=app,bkn.runtime.env=test");
  });

  it("lets explicit safe extra headers override generated trace context", () => {
    const headers = buildHeaders(ctx, {
      "bkn-request-id": "req_override_002",
      traceparent: "00-fedcba0987654321fedcba0987654321-fedcba0987654321-01",
    });
    expect(headers["bkn-request-id"]).toBe("req_override_002");
    expect(headers.traceparent).toBe("00-fedcba0987654321fedcba0987654321-fedcba0987654321-01");
  });
});

describe("resolveContext trace defaults", () => {
  it("generates a stable request id and traceparent for a client context", () => {
    const resolved = resolveContext({ baseUrl: "https://demo.example.com", token: "SECRET" });
    expect(resolved.trace?.requestId).toMatch(/^req_[0-9A-Za-z_.-]+$/);
    expect(resolved.trace?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(resolved.trace?.operationId).toBeUndefined();
    expect(resolved.trace?.attempt).toBeUndefined();
    expect(resolved.trace?.observedAt).toBeUndefined();
    expect(buildHeaders(resolved)["bkn-request-id"]).toBe(resolved.trace?.requestId);
    expect(buildHeaders(resolved)).not.toHaveProperty("bkn-operation-id");
    expect(buildHeaders(resolved)).not.toHaveProperty("bkn-event-observed-at");
  });

  it("accepts a caller supplied request id and valid traceparent", () => {
    const resolved = resolveContext({
      baseUrl: "https://demo.example.com",
      token: "SECRET",
      trace: {
        requestId: "req_external_003",
        traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
      },
    });
    expect(resolved.trace?.requestId).toBe("req_external_003");
    expect(resolved.trace?.traceparent).toBe(
      "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    );
  });

  it("creates replay-stable operation context per logical call, not per client", () => {
    const resolved = resolveContext({
      baseUrl: "https://demo.example.com",
      token: "SECRET",
      trace: { observedAt: "July 27 2026 09:00:00 GMT" },
    });
    if (!resolved.trace) throw new Error("trace context missing");
    const firstOperation = createOperationTraceContext(resolved.trace);
    const replay = buildHeaders({ ...resolved, trace: firstOperation });
    const secondOperation = createOperationTraceContext(resolved.trace);

    expect(resolved.trace.observedAt).toBeUndefined();
    expect(firstOperation.operationId).not.toBe(secondOperation.operationId);
    expect(firstOperation.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(replay["bkn-event-observed-at"]).toBe(firstOperation.observedAt);
    expect(replay["bkn-operation-id"]).toBe(firstOperation.operationId);
  });
});

describe("conversation and interaction correlation ids", () => {
  const base = { baseUrl: "https://demo.example.com", token: "SECRET" };

  it("propagates caller supplied ids as headers", () => {
    const resolved = resolveContext({
      ...base,
      trace: { conversationId: "agent:thread_abc", interactionId: "itr_2026072701" },
    });
    const headers = buildHeaders(resolved);
    expect(headers["bkn-conversation-id"]).toBe("agent:thread_abc");
    expect(headers["bkn-interaction-id"]).toBe("itr_2026072701");
  });

  it("never generates ids when the caller supplies none", () => {
    const resolved = resolveContext(base);
    expect(resolved.trace?.conversationId).toBeUndefined();
    expect(resolved.trace?.interactionId).toBeUndefined();
    const headers = buildHeaders(resolved);
    expect(headers).not.toHaveProperty("bkn-conversation-id");
    expect(headers).not.toHaveProperty("bkn-interaction-id");
  });

  it("drops malformed ids instead of failing the request", () => {
    const resolved = resolveContext({
      ...base,
      trace: { conversationId: "bad id with spaces", interactionId: "x".repeat(129) },
    });
    expect(resolved.trace?.conversationId).toBeUndefined();
    expect(resolved.trace?.interactionId).toBeUndefined();
  });

  it("ignores env vars for library clients so a long-lived client cannot freeze one interaction", () => {
    vi.stubEnv("BKN_CONVERSATION_ID", "cli:conv_1");
    vi.stubEnv("BKN_INTERACTION_ID", "cli:itr_1");
    try {
      const resolved = resolveContext(base);
      expect(resolved.trace?.conversationId).toBeUndefined();
      expect(resolved.trace?.interactionId).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reads env vars at the CLI layer so consecutive CLI processes share one interaction", () => {
    vi.stubEnv("BKN_CONVERSATION_ID", "cli:conv_1");
    vi.stubEnv("BKN_INTERACTION_ID", "cli:itr_1");
    try {
      expect(traceOptionsFrom({})).toEqual({
        conversationId: "cli:conv_1",
        interactionId: "cli:itr_1",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lets a CLI flag win over the env fallback", () => {
    vi.stubEnv("BKN_INTERACTION_ID", "cli:itr_env");
    try {
      expect(traceOptionsFrom({ interactionId: "itr_explicit" })?.interactionId).toBe(
        "itr_explicit",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns no trace options when neither flag nor env is set", () => {
    expect(traceOptionsFrom({})).toBeUndefined();
  });

  it("keeps correlation ids out of baggage", () => {
    const resolved = resolveContext({
      ...base,
      trace: {
        conversationId: "agent:thread_abc",
        interactionId: "itr_2026072701",
        baggage: { "bkn.runtime.env": "test" },
      },
    });
    expect(buildHeaders(resolved).baggage).toBe("bkn.runtime.env=test");
  });
});
