import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFormField, parseHeader, rawCall } from "../../src/api/call.js";
import type { RequestContext } from "../../src/types.js";
import { verifiedContext } from "../setup/verified-context.js";

function ctx(over: Partial<RequestContext> = {}): RequestContext {
  return verifiedContext({
    baseUrl: "https://demo.example.com",
    token: "OLD",
    insecure: false,
    ...over,
  });
}

describe("parseHeader", () => {
  it("splits on the first colon and trims", () => {
    expect(parseHeader("Authorization: Bearer x")).toEqual(["Authorization", "Bearer x"]);
  });
  it("handles values containing colons", () => {
    expect(parseHeader("X-Url: http://a:8080")).toEqual(["X-Url", "http://a:8080"]);
  });
  it("rejects malformed headers", () => {
    expect(parseHeader("nope")).toBeNull();
    expect(parseHeader(":empty-name")).toBeNull();
  });
});

describe("parseFormField", () => {
  it("parses key=value", () => {
    expect(parseFormField("name=demo")).toEqual(["name", "demo", false]);
  });
  it("flags key=@file as a file", () => {
    expect(parseFormField("spec=@/tmp/x.yaml")).toEqual(["spec", "/tmp/x.yaml", true]);
  });
  it("throws without =", () => {
    expect(() => parseFormField("bad")).toThrow();
  });
});

describe("rawCall refresh-on-401", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes the token and retries once on a 401", async () => {
    const auths: (string | null)[] = [];
    let persisted: string | undefined;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/bkn-backend/v1/health")) {
        return new Response(JSON.stringify({ ServerVersion: "0.1.5" }), { status: 200 });
      }
      if (String(url).endsWith("/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "NEW" }), { status: 200 });
      }
      auths.push(new Headers(init?.headers).get("authorization"));
      // First call (OLD token) → 401; retry (NEW token) → 200.
      return auths.length === 1
        ? new Response("denied", { status: 401 })
        : new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", f);

    const res = await rawCall(
      ctx({
        refresh: {
          refreshToken: "RT",
          persist: (t) => {
            persisted = t.accessToken;
          },
        },
      }),
      "/api/x",
    );

    expect(res.status).toBe(200);
    expect(res.body).toBe("ok");
    expect(auths).toEqual(["Bearer OLD", "Bearer NEW"]); // retried with the fresh token
    expect(persisted).toBe("NEW"); // and persisted it
  });

  it("does not retry a 401 without stored refresh credentials", async () => {
    const f = vi.fn(async (url: string) =>
      String(url).endsWith("/api/bkn-backend/v1/health")
        ? new Response(JSON.stringify({ ServerVersion: "0.1.5" }), { status: 200 })
        : new Response("denied", { status: 401 }),
    );
    vi.stubGlobal("fetch", f);
    const res = await rawCall(ctx(), "/api/x"); // no ctx.refresh
    expect(res.status).toBe(401);
    expect(f).toHaveBeenCalledTimes(1); // single business shot
  });
});
