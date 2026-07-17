import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tlsFetch } from "../../src/api/tls.js";

/**
 * A self-signed platform is the whole reason `--insecure` exists, so the test
 * uses a real one: a real cert, a real TLS handshake, a real reject.
 *
 * The cert is minted at run time rather than committed. Node has no
 * certificate-issuing API, so this shells out to openssl — and skips when there
 * is none, since checking in a private key to keep a test hermetic is how key
 * material ends up in a published package.
 */
const CERT_DIR = join(tmpdir(), "bkn-tls-test");
const KEY_PATH = join(CERT_DIR, "k.pem");
const CERT_PATH = join(CERT_DIR, "c.pem");
let server: ReturnType<typeof createServer>;
let url: string;

const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

beforeAll(async () => {
  if (!hasOpenssl) return;
  mkdirSync(CERT_DIR, { recursive: true });
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      KEY_PATH,
      "-out",
      CERT_PATH,
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" },
  );
  server = createServer(
    { key: readFileSync(KEY_PATH), cert: readFileSync(CERT_PATH) },
    (_req, res) => res.end('{"ok":true}'),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  url = `https://localhost:${typeof addr === "object" && addr ? addr.port : 0}/`;
});
afterAll(() => server?.close());

describe.skipIf(!hasOpenssl)("tlsFetch", () => {
  it("verifies certificates by default", async () => {
    await expect(tlsFetch(false, url)).rejects.toThrow();
  });

  it("skips verification when the caller asks", async () => {
    const res = await tlsFetch(true, url);
    expect(await res.json()).toEqual({ ok: true });
  });

  /**
   * The opt-out used to be `NODE_TLS_REJECT_UNAUTHORIZED=0` — process-wide and
   * never restored, so one `-k` silently disabled certificate verification for
   * every later request, including a library consumer's own unrelated traffic.
   * Scoping it to the request is the entire point; assert the blast radius.
   */
  it("leaves certificate verification on for everything else", async () => {
    await tlsFetch(true, url);
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    await expect(tlsFetch(false, url)).rejects.toThrow();
    await expect(fetch(url)).rejects.toThrow();
  });
});

describe("resolveContext + insecure", () => {
  it("never inherits a TLS opt-out from the token store", async () => {
    const { mkdtempSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "bkn-tls-cfg-"));
    const base = "https://self-signed.example";
    const key = Buffer.from(base).toString("base64url");
    const userDir = join(dir, "platforms", key, "users", "u1");
    mkdirSync(userDir, { recursive: true });
    // A pre-0.1.1 store: `auth login -k` persisted the opt-out here.
    writeFileSync(
      join(userDir, "token.json"),
      JSON.stringify({ baseUrl: base, accessToken: "AT", tlsInsecure: true }),
    );
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({ currentPlatform: base, activeUsers: { [base]: "u1" } }),
    );
    const saved = process.env.BKN_CONFIG_DIR;
    process.env.BKN_CONFIG_DIR = dir;
    try {
      const { resolveContext } = await import("../../src/config/resolve.js");
      expect(resolveContext({}).insecure).toBe(false);
      expect(resolveContext({ insecure: true }).insecure).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.BKN_CONFIG_DIR;
      else process.env.BKN_CONFIG_DIR = saved;
    }
  });
});
