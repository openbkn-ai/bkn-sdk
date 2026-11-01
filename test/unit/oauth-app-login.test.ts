import { request as httpRequest } from "node:http";
import { type AddressInfo, createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pkceChallenge } from "../../src/auth/oauth-app.js";
import {
  type HttpError,
  InputError,
  type RefreshableTokens,
  createClient,
  oauth,
} from "../../src/index.js";

const BASE = "https://platform.example.com";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** GET a URL with node:http, so the stubbed global fetch never sees it. */
function get(url: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    httpRequest(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), body }),
      );
    })
      .on("error", reject)
      .end();
  });
}

type Call = { url: string; init?: RequestInit };

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const tokenBody = (init?: RequestInit) => new URLSearchParams(String(init?.body));
const tokenJson = (extra: Record<string, unknown> = {}) =>
  Response.json({ access_token: "acc-1", refresh_token: "ref-1", expires_in: 3600, ...extra });

describe("authorizationRequest", () => {
  it("matches the RFC 7636 appendix B challenge", async () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("builds the URL with PKCE, state and defaults", () => {
    const r = oauth.authorizationRequest(`${BASE}/`, { clientId: "app-1" });
    const u = new URL(r.url);
    expect(`${u.origin}${u.pathname}`).toBe(`${BASE}/oauth2/auth`);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("app-1");
    expect(u.searchParams.get("redirect_uri")).toBe(oauth.DEFAULT_REDIRECT_URI);
    expect(u.searchParams.get("scope")).toBe("openid offline");
    expect(u.searchParams.get("state")).toBe(r.state);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(r.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get("code_challenge")).toBe(pkceChallenge(r.codeVerifier));
    expect(r).toMatchObject({ clientId: "app-1", redirectUri: oauth.DEFAULT_REDIRECT_URI });
    expect(oauth.authorizationRequest(BASE, { clientId: "app-1" }).state).not.toBe(r.state);
  });
});

describe("exchangeCode", () => {
  const req = () =>
    oauth.authorizationRequest(BASE, { clientId: "app-1", redirectUri: "http://127.0.0.1:9/cb" });

  it("rejects a mismatched state without calling the platform", async () => {
    const calls = stubFetch(() => tokenJson());
    await expect(
      oauth.exchangeCode(BASE, req(), { code: "c", state: "other" }),
    ).rejects.toBeInstanceOf(InputError);
    expect(calls).toHaveLength(0);
  });

  it("does the authorization_code grant with the verifier", async () => {
    const r = req();
    const calls = stubFetch(() => tokenJson());
    const t = await oauth.exchangeCode(BASE, r, { code: "the-code", state: r.state });
    expect(calls[0]?.url).toBe(`${BASE}/oauth2/token`);
    const b = tokenBody(calls[0]?.init);
    expect(Object.fromEntries(b)).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "http://127.0.0.1:9/cb",
      client_id: "app-1",
      code_verifier: r.codeVerifier,
    });
    expect(t).toMatchObject({ accessToken: "acc-1", refreshToken: "ref-1" });
    expect(t.expiresAt).toBeTruthy();
  });

  it("carries the platform's error_description on invalid_grant", async () => {
    const r = req();
    stubFetch(() =>
      Response.json(
        { error: "invalid_grant", error_description: "code already used" },
        { status: 400 },
      ),
    );
    const err = await oauth.exchangeCode(BASE, r, { code: "c", state: r.state }).catch((e) => e);
    expect(err).toBeInstanceOf(InputError);
    expect(err.message).toContain("code already used");
  });
});

describe("login", () => {
  async function run(
    browser: (url: string, redirect: string) => Promise<unknown>,
    extra: Partial<Parameters<typeof oauth.login>[1]> = {},
  ) {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const pending: Promise<unknown>[] = [];
    const result = oauth.login(BASE, {
      clientId: "app-1",
      redirectUri,
      openBrowser: false,
      onUrl: (url) => {
        pending.push(browser(url, redirectUri).catch(() => {}));
      },
      ...extra,
    });
    return { result, redirectUri, settled: () => Promise.all(pending) };
  }
  const qs = (url: string) => new URL(url).searchParams;

  it("signs in end to end, listening before onUrl, 404 for a stray path", async () => {
    const calls = stubFetch(() => tokenJson());
    let listening = false;
    let stray = 0;
    let page = { status: 0, type: "", body: "" };
    const { result, settled } = await run(async (url, redirect) => {
      const port = new URL(redirect).port;
      // The server must already accept connections when onUrl runs.
      listening = (await get(`http://127.0.0.1:${port}/nope`)).status === 404;
      stray = (await get(`http://127.0.0.1:${port}/favicon.ico`)).status;
      page = await get(`${redirect}?code=abc&state=${qs(url).get("state")}`);
    });
    const t = await result;
    await settled();
    expect(listening).toBe(true);
    expect(stray).toBe(404);
    expect(page.status).toBe(200);
    expect(page.type).toContain("text/plain");
    expect(page.body).toBe("Signed in. You can close this page.");
    expect(t).toMatchObject({ accessToken: "acc-1", refreshToken: "ref-1" });
    const b = tokenBody(calls[0]?.init);
    expect(b.get("code")).toBe("abc");
    expect(b.get("client_id")).toBe("app-1");
  });

  it("closes the server after sign-in", async () => {
    stubFetch(() => tokenJson());
    let redirectUri = "";
    const { result } = await run(async (url, redirect) => {
      redirectUri = redirect;
      await get(`${redirect}?code=abc&state=${qs(url).get("state")}`);
    });
    await result;
    await expect(get(redirectUri)).rejects.toThrow();
  });

  it("rejects a state mismatch", async () => {
    const calls = stubFetch(() => tokenJson());
    const { result } = await run((_url, redirect) => get(`${redirect}?code=abc&state=forged`));
    await expect(result).rejects.toThrow(/state/);
    expect(calls).toHaveLength(0);
  });

  it("reports a denied sign-in with the platform's description", async () => {
    stubFetch(() => tokenJson());
    const { result } = await run((url, redirect) =>
      get(
        `${redirect}?error=access_denied&error_description=The+user+denied&state=${qs(url).get("state")}`,
      ),
    );
    await expect(result).rejects.toThrow(/The user denied/);
  });

  it("times out and frees the port", async () => {
    stubFetch(() => tokenJson());
    let redirectUri = "";
    const { result } = await run(
      async (_u, redirect) => {
        redirectUri = redirect;
      },
      { timeoutMs: 50 },
    );
    await expect(result).rejects.toThrow(/timed out/);
    await expect(get(redirectUri)).rejects.toThrow();
  });

  it("refuses a non-loopback or non-http redirect", async () => {
    for (const redirectUri of [
      "https://app.example.com/cb",
      "http://app.example.com/cb",
      "https://127.0.0.1:1/cb",
    ]) {
      const err = await oauth
        .login(BASE, { clientId: "a", redirectUri, openBrowser: false, onUrl: () => {} })
        .catch((e) => e);
      expect(err).toBeInstanceOf(InputError);
      expect(err.message).toContain("exchangeCode");
    }
  });

  it("surfaces a token endpoint failure", async () => {
    stubFetch(() =>
      Response.json(
        { error: "invalid_client", error_description: "unknown client" },
        { status: 401 },
      ),
    );
    const { result } = await run((url, redirect) =>
      get(`${redirect}?code=abc&state=${qs(url).get("state")}`),
    );
    await expect(result).rejects.toThrow(/unknown client/);
  });
});

describe("refresh", () => {
  it("rotates the refresh token", async () => {
    const calls = stubFetch(() => tokenJson({ access_token: "acc-2", refresh_token: "ref-2" }));
    const t = await oauth.refresh(BASE, { accessToken: "acc-1", refreshToken: "ref-1" } as never, {
      clientId: "app-1",
    });
    expect(Object.fromEntries(tokenBody(calls[0]?.init))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "ref-1",
      client_id: "app-1",
    });
    expect(t).toMatchObject({ accessToken: "acc-2", refreshToken: "ref-2" });
  });

  it("keeps the old refresh token when the response has none", async () => {
    stubFetch(() => Response.json({ access_token: "acc-2", expires_in: 60 }));
    const t = await oauth.refresh(BASE, { refreshToken: "ref-1" }, { clientId: "app-1" });
    expect(t.refreshToken).toBe("ref-1");
  });

  it("fails with the description on invalid_grant", async () => {
    stubFetch(() =>
      Response.json(
        { error: "invalid_grant", error_description: "token revoked" },
        { status: 400 },
      ),
    );
    await expect(
      oauth.refresh(BASE, { refreshToken: "ref-1" }, { clientId: "app-1" }),
    ).rejects.toThrow(/token revoked/);
  });
});

describe("registerClient", () => {
  it("posts the name and redirect uris", async () => {
    const calls = stubFetch(() =>
      Response.json({
        client_id: "c-1",
        client_name: "My app",
        redirect_uris: ["http://127.0.0.1:8765/callback"],
      }),
    );
    const c = await oauth.registerClient(BASE, { clientName: "My app" });
    expect(calls[0]?.url).toBe(`${BASE}/api/safe/v1/oauth/register`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      client_name: "My app",
      redirect_uris: ["http://127.0.0.1:8765/callback"],
    });
    expect(c).toEqual({
      clientId: "c-1",
      clientName: "My app",
      redirectUris: ["http://127.0.0.1:8765/callback"],
    });
  });

  it("explains a platform without self-registration", async () => {
    stubFetch(() => new Response("not found", { status: 404 }));
    const err = await oauth.registerClient(BASE, { clientName: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(InputError);
    expect(err.message).toMatch(/does not let clients register themselves/);
    expect(err.message).toContain("deviceLogin");
  });

  it("carries error_description from other failures", async () => {
    stubFetch(() =>
      Response.json(
        { error: "invalid_redirect_uri", error_description: "redirect not allowed" },
        { status: 400 },
      ),
    );
    await expect(
      oauth.registerClient(BASE, { clientName: "x", redirectUris: ["https://evil.example/cb"] }),
    ).rejects.toThrow(/redirect not allowed/);
  });
});

describe("createClient with tokens", () => {
  const future = () => new Date(Date.now() + 3_600_000).toISOString();
  const past = () => new Date(Date.now() - 1000).toISOString();

  function platform(
    opts: { refreshOk?: boolean; apiStatus?: (n: number, auth: string) => number } = {},
  ) {
    let apiCalls = 0;
    let refreshes = 0;
    const seen: string[] = [];
    const calls = stubFetch(async (url, init) => {
      if (url.endsWith("/oauth2/token")) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        if (opts.refreshOk === false) {
          return Response.json(
            { error: "invalid_grant", error_description: "revoked" },
            { status: 400 },
          );
        }
        return Response.json({
          access_token: `acc-${refreshes + 1}`,
          refresh_token: `ref-${refreshes + 1}`,
          expires_in: 3600,
        });
      }
      if (url.includes("/health")) return Response.json({ version: "0.0.0" });
      apiCalls++;
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      seen.push(auth);
      const status = opts.apiStatus ? opts.apiStatus(apiCalls, auth) : 200;
      return status === 200 ? Response.json({ entries: [] }) : new Response("no", { status });
    });
    return { calls, seen, refreshes: () => refreshes };
  }

  const make = (tokens: RefreshableTokens, onTokenRefresh?: (t: RefreshableTokens) => void) => {
    vi.stubEnv("BKN_SKIP_VERSION_CHECK", "1");
    return createClient({ baseUrl: BASE, tokens, clientId: "app-1", onTokenRefresh });
  };

  it("refuses token together with tokens", () => {
    expect(() => createClient({ baseUrl: BASE, token: "t", tokens: { accessToken: "a" } })).toThrow(
      InputError,
    );
  });

  it("wires ctx from tokens, ignoring BKN_TOKEN", () => {
    vi.stubEnv("BKN_TOKEN", "env-token");
    const c = createClient({
      baseUrl: BASE,
      tokens: { accessToken: "a", refreshToken: "r", expiresAt: future() },
      clientId: "app-1",
    });
    expect(c.ctx.token).toBe("a");
    expect(c.ctx.tokenFromEnv).toBeUndefined();
    expect(c.ctx.refresh).toMatchObject({ refreshToken: "r", clientId: "app-1", app: true });
    expect(
      createClient({ baseUrl: BASE, tokens: { accessToken: "a", refreshToken: "r" } }).ctx.refresh
        ?.clientId,
    ).toBe("openbkn-sdk");
    expect(
      createClient({ baseUrl: BASE, tokens: { accessToken: "a" } }).ctx.refresh,
    ).toBeUndefined();
  });

  it("refreshes ahead of expiry", async () => {
    const p = platform();
    const onRefresh = vi.fn();
    const c = make({ accessToken: "acc-1", refreshToken: "ref-1", expiresAt: past() }, onRefresh);
    await c.kn.list({ limit: 1 });
    expect(p.refreshes()).toBe(1);
    expect(p.seen).toEqual(["Bearer acc-2"]);
    expect(onRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "acc-2", refreshToken: "ref-2" }),
    );
  });

  it("refreshes on a 401 and retries", async () => {
    const p = platform({ apiStatus: (_n, auth) => (auth === "Bearer acc-1" ? 401 : 200) });
    const onRefresh = vi.fn();
    const c = make({ accessToken: "acc-1", refreshToken: "ref-1", expiresAt: future() }, onRefresh);
    await c.kn.list({ limit: 1 });
    expect(p.seen).toEqual(["Bearer acc-1", "Bearer acc-2"]);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("calls onTokenRefresh once under concurrent requests", async () => {
    const p = platform({ apiStatus: (_n, auth) => (auth === "Bearer acc-1" ? 401 : 200) });
    const onRefresh = vi.fn();
    const c = make({ accessToken: "acc-1", refreshToken: "ref-1", expiresAt: future() }, onRefresh);
    await Promise.all([c.kn.list({ limit: 1 }), c.kn.list({ limit: 1 }), c.kn.list({ limit: 1 })]);
    expect(p.refreshes()).toBe(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("merges the old refresh token when the grant returns none", async () => {
    stubFetch((url) =>
      url.endsWith("/oauth2/token")
        ? Response.json({ access_token: "acc-2", expires_in: 60 })
        : Response.json({ entries: [] }),
    );
    const onRefresh = vi.fn();
    const c = make({ accessToken: "acc-1", refreshToken: "ref-1", expiresAt: past() }, onRefresh);
    await c.kn.list({ limit: 1 });
    expect(onRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "acc-2", refreshToken: "ref-1" }),
    );
  });

  it("surfaces the 401 with a sign-in-again hint when refresh fails", async () => {
    platform({ refreshOk: false, apiStatus: () => 401 });
    const c = make({ accessToken: "acc-1", refreshToken: "ref-1", expiresAt: future() });
    const err = (await c.kn.list({ limit: 1 }).catch((e) => e)) as HttpError;
    expect(err.status).toBe(401);
    expect(err.hint).toMatch(/Sign the user in again/);
    expect(err.hint).not.toMatch(/openbkn auth login/);
  });
});

describe("package entry", () => {
  it("exports the oauth namespace", () => {
    for (const k of [
      "registerClient",
      "authorizationRequest",
      "exchangeCode",
      "login",
      "deviceLogin",
      "refresh",
    ]) {
      expect(typeof (oauth as Record<string, unknown>)[k]).toBe("function");
    }
    expect(oauth.DEFAULT_REDIRECT_URI).toBe("http://127.0.0.1:8765/callback");
  });
});
