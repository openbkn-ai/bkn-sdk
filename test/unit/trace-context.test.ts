import { describe, expect, it } from "vitest";
import { buildHeaders } from "../../src/api/headers.js";
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
