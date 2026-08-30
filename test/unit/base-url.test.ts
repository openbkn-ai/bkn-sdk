import { describe, expect, it } from "vitest";
import { trimTrailingSlashes } from "../../src/utils/base-url.js";

describe("trimTrailingSlashes", () => {
  it("drops one or many trailing slashes", () => {
    expect(trimTrailingSlashes("https://x")).toBe("https://x");
    expect(trimTrailingSlashes("https://x/")).toBe("https://x");
    expect(trimTrailingSlashes("https://x////")).toBe("https://x");
  });

  it("leaves slashes that are not at the end alone", () => {
    expect(trimTrailingSlashes("https://x/api/v1")).toBe("https://x/api/v1");
  });

  it("handles the degenerate inputs the regex it replaced also handled", () => {
    expect(trimTrailingSlashes("")).toBe("");
    expect(trimTrailingSlashes("////")).toBe("");
  });

  it("stays linear on the input CodeQL flagged the regex for", () => {
    // `replace(/\/+$/, "")` retries the `+` from every position on a run of
    // slashes; this is a single backwards scan, so a long run is not a stall.
    const start = performance.now();
    expect(trimTrailingSlashes(`https://x${"/".repeat(200_000)}`)).toBe("https://x");
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
