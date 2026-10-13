import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { createClient } from "../../src/client.js";
import { bknCommand } from "../../src/commands/bkn.js";

const BASE = "https://metric-validation.example.com";
const PATH = "/api/bkn-backend/v1/knowledge-networks/kn-1/metrics/validation";
const originalExitCode = process.exitCode;

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function server(body: unknown, status = 200) {
  const fetch = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    if (new URL(String(url)).pathname === "/api/bkn-backend/v1/health") {
      return Response.json({ ServerVersion: pkg.version });
    }
    return Response.json(body, { status });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function cli() {
  return new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <token>")
    .option("--json")
    .addCommand(bknCommand())
    .parseAsync(
      [
        "--base-url",
        BASE,
        "--token",
        "t",
        "--json",
        "bkn",
        "metric",
        "validate",
        "kn-1",
        "--body",
        '{"entries":[]}',
      ],
      { from: "user" },
    );
}

describe("Metric validation results", () => {
  it.each([
    { valid: true },
    { valid: false, detail: "Object type customer does not exist", extra: "preserved" },
  ])("returns a completed SDK validation without throwing: %j", async (result) => {
    const fetch = server(result);
    const client = createClient({ baseUrl: BASE, token: "t" });
    await expect(client.kn.metricValidate("kn-1", { entries: [] })).resolves.toEqual(result);
    expect(fetch.mock.calls.some(([url]) => new URL(String(url)).pathname === PATH)).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it.each([{ ok: true }, { valid: "false" }, { valid: true, detail: 3 }])(
    "rejects malformed validation responses: %j",
    async (body) => {
      server(body);
      const client = createClient({ baseUrl: BASE, token: "t" });
      await expect(client.kn.metricValidate("kn-1", { entries: [] })).rejects.toMatchObject({
        name: "ZodError",
      });
    },
  );

  it.each([true, false])(
    "prints the CLI result and sets failure status for valid=%s",
    async (valid) => {
      const result = valid ? { valid } : { valid, detail: "Missing metric dependency" };
      server(result);
      const stdout: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((part) => {
        stdout.push(String(part));
        return true;
      });
      await cli();
      expect(JSON.parse(stdout.join(""))).toEqual(result);
      expect(process.exitCode).toBe(valid ? undefined : 1);
    },
  );

  it("preserves an HTTP validation error instead of treating it as a completed result", async () => {
    server({ description: "Invalid request" }, 400);
    const client = createClient({ baseUrl: BASE, token: "t" });
    await expect(client.kn.metricValidate("kn-1", {})).rejects.toMatchObject({ status: 400 });
  });
});
