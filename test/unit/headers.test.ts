import { describe, expect, it } from "vitest";
import { buildHeaders } from "../../src/api/headers.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "SECRET",
  insecure: false,
};

describe("buildHeaders", () => {
  it("sends the token as a Bearer authorization", () => {
    expect(buildHeaders(ctx).authorization).toBe("Bearer SECRET");
  });

  it("merges extra headers", () => {
    expect(buildHeaders(ctx, { accept: "text/csv" }).accept).toBe("text/csv");
  });

  /**
   * The token must ride in `authorization` and nowhere else. fetch defaults to
   * following redirects, and undici strips `authorization` when a redirect
   * crosses origins but keeps custom headers — so a second, non-standard header
   * carrying the same token hands the bearer to the redirect target. The
   * download routes (skills, bkn export) follow redirects, which is exactly
   * where a platform is likely to 302 out to object storage.
   *
   * bkn-safe authenticates on `authorization` alone (verified live: a request
   * carrying only a `token` header gets a 401), so there is nothing to keep.
   */
  it("puts the token in no header other than authorization", () => {
    const headers = buildHeaders(ctx, { accept: "application/json" });
    const carriers = Object.entries(headers)
      .filter(([, v]) => v.includes(ctx.token))
      .map(([k]) => k);
    expect(carriers).toEqual(["authorization"]);
  });
});
