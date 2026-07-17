import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/resources/auth.js";

const saved = { ...process.env };

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
}

beforeEach(() => {
  process.env.BKN_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bkn-auth-"));
  delete process.env.BKN_BASE_URL;
  delete process.env.BKN_TOKEN;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("auth store round-trip", () => {
  it("attach → status → whoami → list → logout", () => {
    const token = jwt({ sub: "u-1", preferred_username: "alice", exp: 9_999_999_999 });
    const r = auth.attachToken("https://demo.example.com", token);
    expect(r).toMatchObject({
      baseUrl: "https://demo.example.com",
      userId: "u-1",
      username: "alice",
    });

    const st = auth.status();
    expect(st).toMatchObject({
      baseUrl: "https://demo.example.com",
      userId: "u-1",
      hasToken: true,
      username: "alice",
      expired: false,
    });

    // whoami enriches the bare claims with the active session's identity so a
    // device-flow `sub`-only token still says who you are.
    expect(auth.whoami()).toMatchObject({
      sub: "u-1",
      baseUrl: "https://demo.example.com",
      userId: "u-1",
      username: "alice",
    });
    expect(auth.currentToken()).toBe(token);

    const list = auth.listPlatforms();
    expect(list).toEqual([
      { baseUrl: "https://demo.example.com", userId: "u-1", username: "alice", active: true },
    ]);

    expect(auth.logout()).toBe(true);
    expect(auth.status().hasToken).toBe(false);
  });

  it("currentTokenFresh refreshes an expired access token and persists it", async () => {
    const expired = jwt({ sub: "u-9", exp: 1 }); // epoch 1970 → expired
    auth.attachToken("https://demo.example.com", expired, { refreshToken: "RT-1" });
    const fresh = jwt({ sub: "u-9", exp: 9_999_999_999 });
    let sentBody = "";
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ access_token: fresh, refresh_token: "RT-2" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", f);
    try {
      expect(await auth.currentTokenFresh()).toBe(fresh);
      expect(auth.currentToken()).toBe(fresh); // persisted to the store
      expect(sentBody).toContain("grant_type=refresh_token");
      expect(sentBody).toContain("refresh_token=RT-1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("currentTokenFresh refreshes an opaque (non-JWT) token it can't verify", async () => {
    auth.attachToken("https://demo.example.com", "opaque-access-xyz", { refreshToken: "RT-o" });
    const f = vi.fn(
      async () => new Response(JSON.stringify({ access_token: "NEW-OPAQUE" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", f);
    try {
      expect(await auth.currentTokenFresh()).toBe("NEW-OPAQUE"); // can't prove validity → refresh
      expect(f).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("currentTokenFresh returns a still-valid token without refreshing", async () => {
    const valid = jwt({ sub: "u-8", exp: 9_999_999_999 });
    auth.attachToken("https://demo.example.com", valid, { refreshToken: "RT-x" });
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    try {
      expect(await auth.currentTokenFresh()).toBe(valid);
      expect(f).not.toHaveBeenCalled(); // not expired → no network call
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("two users on one platform coexist and switch", () => {
    const t1 = jwt({ sub: "u-1", preferred_username: "alice" });
    const t2 = jwt({ sub: "u-2", preferred_username: "bob" });
    auth.attachToken("https://demo.example.com", t1);
    auth.attachToken("https://demo.example.com", t2);
    // Both saved under the same platform, different user dirs.
    expect(
      auth
        .listPlatforms()
        .map((p) => p.userId)
        .sort(),
    ).toEqual(["u-1", "u-2"]);
    // Most recent attach is active.
    expect(auth.status().userId).toBe("u-2");
  });

  /**
   * `auth whoami --user X` is how someone checks which identity `--user X`
   * picks, so these must answer about X, not about the active user. They read
   * the store directly rather than through resolveContext, which is exactly how
   * they came to ignore the flag.
   */
  it("status / whoami / token follow --user instead of the active user", () => {
    auth.attachToken("https://demo.example.com", jwt({ sub: "u-1", preferred_username: "alice" }));
    const bobToken = jwt({ sub: "u-2", preferred_username: "bob" });
    auth.attachToken("https://demo.example.com", bobToken); // bob is now active
    const aliceToken = auth.currentToken({ user: "alice" });

    expect(auth.status().username).toBe("bob");
    expect(auth.status({ user: "alice" }).username).toBe("alice");
    expect(auth.whoami().sub).toBe("u-2");
    expect(auth.whoami({ user: "alice" }).sub).toBe("u-1");
    expect(auth.currentToken()).toBe(bobToken);
    expect(aliceToken).not.toBe(bobToken);
    // Reading as alice must not promote her to active.
    expect(auth.status().username).toBe("bob");
  });

  it("--user rejects an unknown user rather than answering about another", () => {
    auth.attachToken("https://demo.example.com", jwt({ sub: "u-1", preferred_username: "alice" }));
    expect(() => auth.status({ user: "nobody" })).toThrow(/No saved user/);
    expect(() => auth.whoami({ user: "nobody" })).toThrow(/No saved user/);
    expect(() => auth.currentToken({ user: "nobody" })).toThrow(/No saved user/);
  });

  it("use without saved creds throws", () => {
    expect(() => auth.use("https://unknown.example.com")).toThrow();
  });

  // The JWT is never signature-checked, so `sub` is attacker-supplied and lands
  // in a filesystem path. Left unconstrained, `auth login --token <hostile>`
  // writes token.json outside the store — including over another platform's
  // saved credentials, which silently repoints that platform at the attacker.
  it.each([
    ["../../../../escaped", "traversal"],
    ["../../aHR0cHM6Ly9wcm9k/users/default", "another platform's token"],
    ["..", "parent"],
    ["a/b", "separator"],
    ["a\\b", "windows separator"],
  ])("refuses to store a token whose sub is %j (%s)", (sub) => {
    expect(() => auth.attachToken("https://demo.example.com", jwt({ sub }))).toThrow(
      /not a usable user id/,
    );
  });

  it("stores a token whose sub is an ordinary opaque id", () => {
    const sub = "8f14e45f-ceea-467a-9575-4b0b6f3b1a2c";
    expect(auth.attachToken("https://demo.example.com", jwt({ sub })).userId).toBe(sub);
  });
});
