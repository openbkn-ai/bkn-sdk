import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "../../src/api/http.js";
import type { RequestContext } from "../../src/types.js";
import { HttpError, NonJsonResponseError, ToolError, formatError } from "../../src/utils/errors.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
};

function respond(body: string, init: ResponseInit): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, init)),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("non-JSON responses", () => {
  it("hints that an HTML error page never reached the service", async () => {
    respond("<html><body><center>404 Not Found</center></body></html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    });
    const err = await request(ctx, "/api/automation/v1/data-flow/flow", { body: {} }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).hint).toMatch(
      /did not reach the service behind \/api\/automation\/v1\/data-flow\/flow/,
    );
    // The user-facing line carries the hint, not just "HTTP 404".
    expect(formatError(err)).toMatch(/not deployed or not routed/);
  });

  it("keeps the AppKey guidance when an auth proxy answers 401 with HTML", async () => {
    respond("<html><body>401 Authorization Required</body></html>", {
      status: 401,
      headers: { "content-type": "text/html" },
    });
    const err = await request({ ...ctx, token: "bak_123" }, "/api/vega-backend/v1/resources").catch(
      (e) => e,
    );
    // Both diagnoses apply: the gateway ate the request AND the key is the thing
    // to re-issue. Neither may hide the other.
    expect((err as HttpError).hint).toMatch(/did not reach the service/);
    expect((err as HttpError).hint).toMatch(/appkey create/);
  });

  it("carries the routing hint into a 403, which reads as a permissions problem", async () => {
    respond("<html><body>403 Forbidden</body></html>", {
      status: 403,
      headers: { "content-type": "text/html" },
    });
    const err = await request(ctx, "/api/automation/v2/dags").catch((e) => e);
    expect(formatError(err)).toMatch(/did not reach the service/);
  });

  it("detects a gateway page sent with a 200 and no html content-type", async () => {
    respond("<!DOCTYPE html><html><body>hello</body></html>", { status: 200 });
    const err = await request(ctx, "/api/vega-backend/v1/resources").catch((e) => e);
    expect(err).toBeInstanceOf(NonJsonResponseError);
    expect(formatError(err)).toMatch(/did not reach the service/);
  });

  it("reports a non-JSON 200 body instead of throwing a bare SyntaxError", async () => {
    respond("not json at all", { status: 200, headers: { "content-type": "text/plain" } });
    const err = await request(ctx, "/api/vega-backend/v1/resources").catch((e) => e);
    expect(err).toBeInstanceOf(NonJsonResponseError);
    expect(formatError(err)).toMatch(/non-JSON body \(text\/plain\).*not json at all/);
  });

  it("still returns undefined for an empty body", async () => {
    respond("", { status: 200 });
    await expect(request(ctx, "/api/vega-backend/v1/resources/r-1")).resolves.toBeUndefined();
  });
});

describe("gateway error pages", () => {
  it("does not call a timed-out backend missing", async () => {
    respond("<html><head><title>504 Gateway Time-out</title></head></html>", {
      status: 504,
      headers: { "content-type": "text/html" },
    });
    const err = await request(ctx, "/api/agent-operator-integration/v1/function/execute", {
      body: {},
    }).catch((e) => e);
    // A 504 means the service is routed and slow — a sandbox run that blocks on
    // an unreachable address produces one. Telling the caller their backend is
    // absent sends them to debug the wrong thing.
    expect(formatError(err)).toMatch(/gateway timed out/i);
    expect(formatError(err)).not.toMatch(/not deployed/i);
  });

  it("still says missing when the gateway says the route is gone", async () => {
    respond("<html><body>404 Not Found</body></html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    });
    const err = await request(ctx, "/api/x/v1/thing").catch((e) => e);
    expect(formatError(err)).toMatch(/not deployed or not routed/i);
  });
});

describe("managed-context errors", () => {
  it("redacts raw tool details for a known lifecycle error", () => {
    const message = formatError(
      new ToolError(
        "Context-loader error: interaction terminal; query=bkn_context%3Dsecret&token=secret",
        "interaction_terminal",
      ),
    );

    expect(message).toContain("interaction_terminal");
    expect(message).not.toContain("bkn_context");
    expect(message).not.toContain("secret");
  });

  it("keeps unknown tool errors unchanged for compatibility", () => {
    expect(formatError(new ToolError("tool rejected argument x", "custom_error"))).toBe(
      "tool rejected argument x",
    );
  });
});
