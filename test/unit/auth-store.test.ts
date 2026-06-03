import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

    expect(auth.whoami().sub).toBe("u-1");
    expect(auth.currentToken()).toBe(token);

    const list = auth.listPlatforms();
    expect(list).toEqual([
      { baseUrl: "https://demo.example.com", userId: "u-1", username: "alice", active: true },
    ]);

    expect(auth.logout()).toBe(true);
    expect(auth.status().hasToken).toBe(false);
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

  it("use without saved creds throws", () => {
    expect(() => auth.use("https://unknown.example.com")).toThrow();
  });
});
