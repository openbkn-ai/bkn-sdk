import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMyApiKey,
  listApiKeysAdmin,
  listMyApiKeys,
  regenerateMyApiKey,
  revokeApiKeyAdmin,
  revokeMyApiKey,
} from "../../src/api/app-keys.js";
import { request } from "../../src/api/http.js";
import type { RequestContext } from "../../src/types.js";
import { HttpError, formatError } from "../../src/utils/errors.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
};

type CallArgs = [string, RequestInit];
function mockFetch(): typeof fetch {
  const fn = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function firstCall(f: typeof fetch): CallArgs {
  const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!a) throw new Error("fetch not called");
  return a;
}
afterEach(() => vi.unstubAllGlobals());

describe("appkey self-service (/me/api-keys)", () => {
  it("list GETs /me/api-keys", async () => {
    const f = mockFetch();
    await listMyApiKeys(ctx);
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/safe/v1/me/api-keys");
    expect(call[1].method).toBe("GET");
  });

  it("create POSTs name + maps neverExpire → never_expire, omits expires_at", async () => {
    const f = mockFetch();
    await createMyApiKey(ctx, { name: "cursor", neverExpire: true });
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/safe/v1/me/api-keys");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body as string)).toEqual({ name: "cursor", never_expire: true });
  });

  it("create maps expiresAt → expires_at and drops never_expire when false", async () => {
    const f = mockFetch();
    await createMyApiKey(ctx, { name: "ci", expiresAt: "2027-01-01T00:00:00Z" });
    expect(JSON.parse(firstCall(f)[1].body as string)).toEqual({
      name: "ci",
      expires_at: "2027-01-01T00:00:00Z",
    });
  });

  it("revoke DELETEs /me/api-keys/:id (by id, encoded)", async () => {
    const f = mockFetch();
    await revokeMyApiKey(ctx, "id/1");
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/safe/v1/me/api-keys/id%2F1");
    expect(call[1].method).toBe("DELETE");
  });

  it("regenerate POSTs /me/api-keys/:id/regenerate (no body)", async () => {
    const f = mockFetch();
    await regenerateMyApiKey(ctx, "k1");
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/safe/v1/me/api-keys/k1/regenerate");
    expect(call[1].method).toBe("POST");
    expect(call[1].body).toBeUndefined();
  });
});

describe("appkey admin (/admin/api-keys)", () => {
  it("admin list passes owner_id when given", async () => {
    const f = mockFetch();
    await listApiKeysAdmin(ctx, "u-9");
    const u = new URL(firstCall(f)[0]);
    expect(u.pathname).toBe("/api/safe/v1/admin/api-keys");
    expect(u.searchParams.get("owner_id")).toBe("u-9");
  });

  it("admin list omits owner_id when absent", async () => {
    const f = mockFetch();
    await listApiKeysAdmin(ctx);
    expect(new URL(firstCall(f)[0]).searchParams.has("owner_id")).toBe(false);
  });

  it("admin revoke DELETEs /admin/api-keys/:id", async () => {
    const f = mockFetch();
    await revokeApiKeyAdmin(ctx, "k1");
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/safe/v1/admin/api-keys/k1");
    expect(call[1].method).toBe("DELETE");
  });
});

describe("appkey 401 → re-issue guidance (OPE-22)", () => {
  function mock401(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 })),
    );
  }

  it("a bak_ AppKey 401 carries re-issue guidance, not auth-login", async () => {
    mock401();
    const appKeyCtx: RequestContext = { ...ctx, token: "bak_keyid_secret" };
    const err = await request(appKeyCtx, "/api/agent-retrieval/v1/mcp/info").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).hint).toMatch(/re-issue/i);
    const msg = formatError(err);
    expect(msg).toContain("appkey create");
    expect(msg).not.toContain("auth login");
  });

  it("a non-AppKey (OAuth) 401 keeps the default auth-login guidance", async () => {
    mock401();
    const oauthCtx: RequestContext = { ...ctx, token: "ory_at_xyz" };
    const err = await request(oauthCtx, "/api/agent-retrieval/v1/mcp/info").catch((e) => e);
    expect((err as HttpError).hint).toBeUndefined();
    expect(formatError(err)).toContain("auth login");
  });
});
