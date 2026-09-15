import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "../../src/api/http.js";
import type { RequestContext } from "../../src/types.js";
import { HttpError, NonJsonResponseError, ToolError, formatError } from "../../src/utils/errors.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

function respond(body: string, init: ResponseInit): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, init)),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("request 401 recovery", () => {
  it("rebuilds Authorization after refresh while preserving the request", async () => {
    const persist = vi.fn();
    const context = verifiedContext<RequestContext>({
      ...ctx,
      token: "old-token",
      refresh: { refreshToken: "refresh-token", persist },
    });
    const sent: Array<{ authorization: string | null; init?: RequestInit }> = [];
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/oauth2/token")) {
        return Response.json({ access_token: "new-token", refresh_token: "new-refresh-token" });
      }
      const authorization = new Headers(init?.headers).get("authorization");
      sent.push({ authorization, init });
      return authorization === "Bearer new-token"
        ? Response.json({ entries: [] })
        : Response.json({ error: "expired" }, { status: 401 });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(
      request(context, "/api/example/query", {
        body: { limit: 10 },
        headers: { "x-example": "kept" },
      }),
    ).resolves.toEqual({ entries: [] });

    expect(sent.map((s) => s.authorization)).toEqual(["Bearer old-token", "Bearer new-token"]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "new-token", refreshToken: "new-refresh-token" }),
    );
    for (const { init } of sent) {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe('{"limit":10}');
      expect(new Headers(init?.headers).get("x-example")).toBe("kept");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    }
  });

  it.each([true, false])("stops after one refresh attempt (refresh succeeds: %s)", async (ok) => {
    const persist = vi.fn();
    const context = verifiedContext<RequestContext>({
      ...ctx,
      refresh: { refreshToken: "refresh-token", persist },
    });
    const fetch = vi.fn(async (url: string | URL) => {
      if (String(url).endsWith("/oauth2/token")) {
        return ok
          ? Response.json({ access_token: "new-token" })
          : Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({ error: "unauthorized" }, { status: 401 });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(request(context, "/api/example")).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(ok ? 3 : 2);
    expect(persist).toHaveBeenCalledTimes(ok ? 1 : 0);
  });

  it("does not refresh an explicit token without stored refresh credentials", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "expired" }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(request(ctx, "/api/example")).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

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
    const err = await request(
      verifiedContext({ ...ctx, token: "bak_123" }),
      "/api/vega-backend/v1/resources",
    ).catch((e) => e);
    // Both diagnoses apply: the gateway ate the request AND the key is the thing
    // to re-issue. Neither may hide the other.
    expect((err as HttpError).hint).toMatch(/did not reach the service/);
    expect((err as HttpError).hint).toMatch(/appkey create/);
  });

  it("names BKN_TOKEN on a 401, since it silently outranks a fresh `auth login`", async () => {
    respond('{"code":"Public.Unauthorized"}', {
      status: 401,
      headers: { "content-type": "application/json" },
    });
    const err = await request(
      verifiedContext({ ...ctx, token: "bak_stale", tokenFromEnv: true }),
      "/api/bkn-backend/v1/knowledge-networks",
    ).catch((e) => e);
    expect((err as HttpError).hint).toMatch(/BKN_TOKEN.*unset BKN_TOKEN/);
    expect((err as HttpError).hint).toMatch(/appkey create/);
  });

  it("keeps BKN_TOKEN out of a 401 hint when the token came from the session", async () => {
    respond('{"code":"Public.Unauthorized"}', {
      status: 401,
      headers: { "content-type": "application/json" },
    });
    const err = await request(
      verifiedContext({ ...ctx, token: "bak_123" }),
      "/api/bkn-backend/v1/knowledge-networks",
    ).catch((e) => e);
    expect((err as HttpError).hint).not.toMatch(/BKN_TOKEN/);
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

describe("access-token renewal", () => {
  const base = "https://demo.example.com";

  function jwt(exp: number): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b64({ alg: "RS256" })}.${b64({ sub: "u", exp })}.sig`;
  }

  /** A context holding stored refresh credentials, as `resolveContext` builds one. */
  function refreshable(token: string, over: { expiresAt?: string } = {}): RequestContext {
    return verifiedContext<RequestContext>({
      baseUrl: base,
      token,
      insecure: false,
      refresh: { refreshToken: "RT", persist: vi.fn(), ...over },
    });
  }

  /**
   * Answer the token endpoint with `NEW`, and every API call by whether its
   * bearer is `NEW` — recording each bearer the API saw.
   */
  function platform(opts: { refresh?: "ok" | "reject"; refreshDelayMs?: number } = {}) {
    const bearers: string[] = [];
    let refreshes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith("/oauth2/token")) {
          refreshes += 1;
          if (opts.refreshDelayMs) await new Promise((r) => setTimeout(r, opts.refreshDelayMs));
          return opts.refresh === "reject"
            ? new Response('{"error":"invalid_grant"}', { status: 400 })
            : new Response(JSON.stringify({ access_token: "NEW", expires_in: 3600 }), {
                status: 200,
              });
        }
        const bearer = String((init?.headers as Record<string, string>).authorization);
        bearers.push(bearer);
        return bearer === "Bearer NEW"
          ? new Response('{"ok":true}', { status: 200 })
          : new Response('{"error":"token expired"}', { status: 401 });
      }),
    );
    return { bearers, refreshes: () => refreshes };
  }

  it("retries a 401 with the renewed token, not the one that was rejected", async () => {
    const p = platform();
    const c = refreshable("OLD");
    await expect(request(c, "/api/x")).resolves.toEqual({ ok: true });
    // Regression: the retry used to resend the headers built before the refresh.
    expect(p.bearers).toEqual(["Bearer OLD", "Bearer NEW"]);
    expect(c.refresh?.persist).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "NEW", expiresAt: expect.any(String) }),
    );
  });

  it("renews an expired JWT before sending, so no request is rejected first", async () => {
    const p = platform();
    await request(refreshable(jwt(1)), "/api/x");
    expect(p.bearers).toEqual(["Bearer NEW"]);
  });

  it("renews an opaque token whose recorded expiry is under a minute away", async () => {
    const p = platform();
    const soon = new Date(Date.now() + 30_000).toISOString();
    await request(refreshable("OPAQUE", { expiresAt: soon }), "/api/x");
    expect(p.bearers).toEqual(["Bearer NEW"]);
  });

  it("leaves a token with time to spare alone", async () => {
    const p = platform();
    const later = new Date(Date.now() + 30 * 60_000).toISOString();
    await request(refreshable("OPAQUE", { expiresAt: later }), "/api/x");
    // Sent as-is first; this stub's 401 is what triggers the one renewal.
    expect(p.bearers).toEqual(["Bearer OPAQUE", "Bearer NEW"]);
    expect(p.refreshes()).toBe(1);
  });

  it("renews once for concurrent 401s — refresh tokens rotate, a second use is refused", async () => {
    const p = platform({ refreshDelayMs: 20 });
    const c = refreshable("OLD");
    await Promise.all([request(c, "/api/a"), request(c, "/api/b"), request(c, "/api/c")]);
    expect(p.refreshes()).toBe(1);
    expect(p.bearers.filter((b) => b === "Bearer NEW")).toHaveLength(3);
  });

  it("says the refresh token was rejected when renewal fails", async () => {
    platform({ refresh: "reject" });
    const err = await request(refreshable("OLD"), "/api/x").catch((e) => e);
    expect((err as HttpError).status).toBe(401);
    expect(formatError(err)).toMatch(/could not be renewed: the refresh token was rejected/);
    expect(formatError(err)).toMatch(/openbkn auth login https:\/\/demo\.example\.com/);
  });

  it("points a non-renewable token at login and at AppKeys for scripts", async () => {
    platform();
    const err = await request(ctx, "/api/x").catch((e) => e);
    expect(formatError(err)).toMatch(/no refresh token is saved/);
    expect(formatError(err)).toMatch(/openbkn appkey create/);
  });
});
