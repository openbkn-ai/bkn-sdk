import { describe, expect, it } from "vitest";
import { decodeJwt, isExpired } from "../../src/auth/jwt.js";

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
}

describe("decodeJwt", () => {
  it("decodes the payload claims", () => {
    const token = makeJwt({ sub: "u-1", preferred_username: "alice" });
    expect(decodeJwt(token)).toMatchObject({ sub: "u-1", preferred_username: "alice" });
  });
  it("returns undefined for non-JWT input", () => {
    expect(decodeJwt("not-a-token")).toBeUndefined();
  });
});

describe("isExpired", () => {
  it("is true when exp is in the past", () => {
    expect(isExpired({ exp: 1 }, 10_000)).toBe(true);
  });
  it("is false without exp", () => {
    expect(isExpired({}, 10_000)).toBe(false);
  });
});
