import { describe, expect, it, vi } from "vitest";
import { buildHeaders } from "../../src/api/headers.js";
import { traceOptionsFrom } from "../../src/commands/_shared.js";
import { resolveContext } from "../../src/config/resolve.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "SECRET",
  businessDomain: "bd_public",
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
    expect(buildHeaders(resolved)["bkn-request-id"]).toBe(resolved.trace?.requestId);
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
});

describe("caller-owned conversation and interaction ids", () => {
  it("propagates explicitly supplied ids as headers", () => {
    const resolved = resolveContext({
      baseUrl: "https://demo.example.com",
      token: "SECRET",
      trace: {
        conversationId: "agent:thread_supply_chain",
        interactionId: "int_supply_chain_001",
      },
    } as Parameters<typeof resolveContext>[0]);

    const headers = buildHeaders(resolved);
    expect(headers["bkn-conversation-id"]).toBe("agent:thread_supply_chain");
    expect(headers["bkn-interaction-id"]).toBe("int_supply_chain_001");
  });

  it("does not generate grouping ids when the caller supplies none", () => {
    const resolved = resolveContext({
      baseUrl: "https://demo.example.com",
      token: "SECRET",
    });
    const headers = buildHeaders(resolved);
    expect(headers).not.toHaveProperty("bkn-conversation-id");
    expect(headers).not.toHaveProperty("bkn-interaction-id");
  });

  it("drops malformed grouping ids without rejecting the request", () => {
    const resolved = resolveContext({
      baseUrl: "https://demo.example.com",
      token: "SECRET",
      trace: {
        conversationId: "bad id with spaces",
        interactionId: "x".repeat(129),
      },
    } as Parameters<typeof resolveContext>[0]);

    const headers = buildHeaders(resolved);
    expect(headers).not.toHaveProperty("bkn-conversation-id");
    expect(headers).not.toHaveProperty("bkn-interaction-id");
  });

  it("keeps CLI env fallback out of long-lived SDK clients", () => {
    vi.stubEnv("BKN_CONVERSATION_ID", "cli:conversation_1");
    vi.stubEnv("BKN_INTERACTION_ID", "cli:interaction_1");
    try {
      const resolved = resolveContext({
        baseUrl: "https://demo.example.com",
        token: "SECRET",
      });
      expect(resolved.trace?.conversationId).toBeUndefined();
      expect(resolved.trace?.interactionId).toBeUndefined();
      expect(traceOptionsFrom({})).toEqual({
        conversationId: "cli:conversation_1",
        interactionId: "cli:interaction_1",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
