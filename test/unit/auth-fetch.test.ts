import { describe, expect, it, vi } from "vitest";
import { authFetch } from "../../src/api/auth-fetch.js";
import type { RequestContext } from "../../src/types.js";

function ctx(over: Partial<RequestContext> = {}): RequestContext {
  return {
    baseUrl: "https://demo.example.com",
    token: "OLD",
    insecure: false,
    ...over,
  };
}

describe("authFetch", () => {
  it("refreshes on a 401 and retries the send with the fresh token", async () => {
    const c = ctx({
      refresh: {
        refreshToken: "RT",
        persist: () => {},
      },
    });
    // The refresh endpoint is hit by tryRefresh → refreshAccessToken.
    const tokenFetch = vi.fn(
      async () => new Response(JSON.stringify({ access_token: "NEW" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", tokenFetch);

    let attempt = 0;
    const send = vi.fn(async () => {
      attempt += 1;
      // First send sees the stale token → 401; after refresh mutates ctx.token,
      // the retry reads the fresh token off ctx and succeeds.
      return attempt === 1
        ? new Response("nope", { status: 401 })
        : new Response(`ok:${c.token}`, { status: 200 });
    });

    try {
      const res = await authFetch(c, send);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok:NEW"); // ctx.token was refreshed before retry
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not retry when there are no stored refresh credentials", async () => {
    const send = vi.fn(async () => new Response("nope", { status: 401 }));
    const res = await authFetch(ctx(), send); // no ctx.refresh
    expect(res.status).toBe(401);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("passes a 2xx straight through without touching the network for a refresh", async () => {
    const send = vi.fn(async () => new Response("ok", { status: 200 }));
    const res = await authFetch(ctx({ refresh: { refreshToken: "RT", persist: () => {} } }), send);
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
