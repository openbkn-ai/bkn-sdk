import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveContext } from "../../src/config/resolve.js";
import { InputError } from "../../src/utils/errors.js";

const saved = { ...process.env };

beforeEach(() => {
  // Isolate the store to an empty temp dir so only env/opts feed resolution.
  process.env.BKN_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bkn-test-"));
  delete process.env.BKN_BASE_URL;
  delete process.env.BKN_TOKEN;
});

afterEach(() => {
  process.env = { ...saved };
});

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
