import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceLogin } from "../../src/auth/oauth.js";

/**
 * Mock fetch for the device flow: `/oauth2/device/auth` returns the supplied
 * authorization payload; each `/oauth2/token` POST returns the next item from
 * `tokenSeq` (a {status, body} pair).
 */
function mockDeviceFetch(auth: Record<string, unknown>, tokenSeq: Array<[number, unknown]>) {
  let i = 0;
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
    if (String(url).endsWith("/oauth2/device/auth")) {
      return new Response(JSON.stringify(auth), { status: 200 });
    }
    const [status, body] = tokenSeq[Math.min(i++, tokenSeq.length - 1)] ?? [400, {}];
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}

const AUTH = {
  device_code: "dc-1",
  user_code: "WXYZ-1234",
  verification_uri: "https://platform/device",
  verification_uri_complete: "https://platform/device?user_code=WXYZ-1234",
  expires_in: 300,
  interval: 0, // poll immediately — keeps the test fast
};

afterEach(() => vi.unstubAllGlobals());

describe("deviceLogin (RFC 8628)", () => {
  it("prompts then polls authorization_pending → token", async () => {
    mockDeviceFetch(AUTH, [
      [400, { error: "authorization_pending" }],
      [200, { access_token: "AT", refresh_token: "RT", id_token: "IT" }],
    ]);
    const prompts: string[] = [];
    const tokens = await deviceLogin("https://platform/", {
      onPrompt: (p) => prompts.push(`${p.userCode}@${p.verificationUri}`),
    });
    expect(tokens).toEqual({ accessToken: "AT", refreshToken: "RT", idToken: "IT" });
    expect(prompts).toEqual(["WXYZ-1234@https://platform/device"]);
  });

  it("sends client_id + scope; no client secret", async () => {
    const f = mockDeviceFetch(AUTH, [[200, { access_token: "AT" }]]);
    await deviceLogin("https://platform", {});
    const calls = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const init = calls[0]?.[1];
    const body = String(init?.body);
    expect(body).toContain("client_id=openbkn");
    expect(body).toContain("scope=openid+offline"); // URLSearchParams encodes space as '+'
    expect(body).not.toContain("client_secret");
    expect(body).not.toContain("all"); // seeded client has no `all` scope
  });

  it("throws on access_denied", async () => {
    mockDeviceFetch(AUTH, [[400, { error: "access_denied" }]]);
    await expect(deviceLogin("https://platform")).rejects.toThrow(/denied/i);
  });

  it("throws on expired_token", async () => {
    mockDeviceFetch(AUTH, [[400, { error: "expired_token" }]]);
    await expect(deviceLogin("https://platform")).rejects.toThrow(/expired/i);
  });

  it("throws when device auth omits verification_uri", async () => {
    mockDeviceFetch({ device_code: "x", user_code: "y", expires_in: 300, interval: 0 }, [
      [200, { access_token: "AT" }],
    ]);
    await expect(deviceLogin("https://platform")).rejects.toThrow(/verification_uri/);
  });
});
