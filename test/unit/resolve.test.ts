import { describe, expect, it } from "vitest";
import { resolveContext } from "../../src/config/resolve.js";
import { attachToken } from "../../src/resources/auth.js";
import { InputError } from "../../src/utils/errors.js";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
}

/** The `sub` a resolved token belongs to — which identity would actually act. */
function subOf(token: string): unknown {
  const payload = token.split(".")[1] as string;
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

describe("resolveContext", () => {
  it("uses explicit options over env", () => {
    process.env.BKN_BASE_URL = "https://env.example.com";
    process.env.BKN_TOKEN = "env-token";
    const ctx = resolveContext({ baseUrl: "https://opt.example.com", token: "opt-token" });
    expect(ctx.baseUrl).toBe("https://opt.example.com");
    expect(ctx.token).toBe("opt-token");
    expect(ctx.businessDomain).toBe("bd_public");
  });

  it("falls back to env vars", () => {
    process.env.BKN_BASE_URL = "https://env.example.com/";
    process.env.BKN_TOKEN = "env-token";
    const ctx = resolveContext();
    expect(ctx.baseUrl).toBe("https://env.example.com"); // trailing slash trimmed
    expect(ctx.token).toBe("env-token");
  });

  it("throws InputError without a base URL", () => {
    expect(() => resolveContext()).toThrow(InputError);
  });

  it("throws InputError when a base URL exists but no token", () => {
    expect(() => resolveContext({ baseUrl: "https://x.example.com" })).toThrow(InputError);
  });
});

describe("resolveContext + --user", () => {
  const BASE = "https://multi.example.com";

  function seed() {
    attachToken(BASE, jwt({ sub: "u-admin", preferred_username: "admin" }));
    attachToken(BASE, jwt({ sub: "u-bot", preferred_username: "readonly-bot" }));
    // Last attach wins, so `admin` is NOT the active user — a silent fallback
    // would therefore be visible as the wrong token, not merely the wrong id.
    return { active: "u-bot" };
  }

  it("selects the named user's token, by username", () => {
    seed();
    expect(subOf(resolveContext({ baseUrl: BASE, user: "admin" }).token)).toBe("u-admin");
  });

  it("selects the named user's token, by user id", () => {
    seed();
    expect(subOf(resolveContext({ baseUrl: BASE, user: "u-admin" }).token)).toBe("u-admin");
  });

  it("reads BKN_USER when no option is passed", () => {
    seed();
    process.env.BKN_USER = "admin";
    expect(subOf(resolveContext({ baseUrl: BASE }).token)).toBe("u-admin");
  });

  it("uses the active user when --user is absent", () => {
    const { active } = seed();
    expect(subOf(resolveContext({ baseUrl: BASE }).token)).toBe(active);
  });

  /**
   * The flag reads as a privilege-scoping control. Falling back to the active
   * user — plausibly an admin — would hand a command more authority than it
   * asked for, silently. It must fail instead.
   */
  it("throws rather than falling back when the user is unknown", () => {
    seed();
    expect(() => resolveContext({ baseUrl: BASE, user: "nobody" })).toThrow(InputError);
    expect(() => resolveContext({ baseUrl: BASE, user: "nobody" })).toThrow(/No saved user/);
  });
});
