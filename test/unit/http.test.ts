import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "../../src/api/http.js";
import type { RequestContext } from "../../src/types.js";
import { HttpError, NonJsonResponseError, formatError } from "../../src/utils/errors.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
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
