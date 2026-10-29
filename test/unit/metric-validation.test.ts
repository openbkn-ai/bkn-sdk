import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { createClient } from "../../src/client.js";
import { bknCommand } from "../../src/commands/bkn.js";

const BASE = "https://metric-validation.example.com";
const PATH = "/api/bkn-backend/v1/knowledge-networks/kn-1/object-metrics/validate";
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
        "object-metric",
        "validate",
        "kn-1",
        "--body",
        '{"code":"stock","name":"Stock"}',
      ],
      { from: "user" },
    );
}

describe("Object Metric V1 validation results", () => {
  it.each([true, false])(
    "returns a completed result and sets CLI status for valid=%s",
    async (valid) => {
      const result = {
        valid,
        issues: valid
          ? []
          : [{ code: "missing", field: "owner_object_type_id", message: "Required" }],
        output_shape: "summary",
      };
      const fetch = server(result);
      const client = createClient({ baseUrl: BASE, token: "t" });
      await expect(client.kn.objectMetricValidate("kn-1", {})).resolves.toEqual(result);
      const stdout: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((part) => {
        stdout.push(String(part));
        return true;
      });
      await cli();
      expect(JSON.parse(stdout.join(""))).toEqual(result);
      expect(process.exitCode).toBe(valid ? undefined : 1);
      expect(fetch.mock.calls.some(([url]) => new URL(String(url)).pathname === PATH)).toBe(true);
    },
  );

  it.each([
    null,
    {},
    { valid: "false", issues: [], output_shape: "summary" },
    { valid: true, issues: null, output_shape: "summary" },
    { valid: true, issues: [], output_shape: "object_value" },
  ])("rejects malformed responses: %j", async (body) => {
    server(body);
    await expect(
      createClient({ baseUrl: BASE, token: "t" }).kn.objectMetricValidate("kn-1", {}),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("preserves an HTTP error", async () => {
    server({ description: "Invalid request" }, 400);
    await expect(
      createClient({ baseUrl: BASE, token: "t" }).kn.objectMetricValidate("kn-1", {}),
    ).rejects.toMatchObject({ status: 400 });
  });
});
