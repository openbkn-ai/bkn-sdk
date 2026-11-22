import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { vegaCommand } from "../../src/commands/vega.js";
import { writeVersionCheckCache } from "../../src/config/store.js";

const base = ["--base-url", "https://api.example.com", "--token", "t", "vega", "resource"];
function cli() {
  return new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <token>")
    .addCommand(vegaCommand());
}
beforeEach(() => {
  writeVersionCheckCache("https://api.example.com", {
    serverVersion: pkg.version,
    checkedAt: new Date().toISOString(),
  });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("API Resource CLI", () => {
  it("creates a read-only API and preserves numeric definition and schema metadata", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) => new Response('{"id":"r1"}'),
    );
    vi.stubGlobal("fetch", fetchMock);
    await cli().parseAsync(
      [
        ...base,
        "create",
        "--catalog-id",
        "c1",
        "--name",
        "records",
        "--category",
        "api",
        "--api-definition",
        '{"request":{"method":"GET","path":"/records"},"response":{"content_type":"application/json","statuses":{"200":{"description":"Rows","schema":{"type":"array"},"result_rows":""}}},"success_rule":{"http_status":[200]}}',
        "--schema-definition",
        '[{"name":"amount","type":"decimal","filterable":true,"attributes":{"precision":18,"scale":2,"display_sample":1234567890123456.78}}]',
        "--validation",
        '{"filter_condition":{"operation":"eq","field":"amount","value":1234567890123456.78}}',
      ],
      { from: "user" },
    );
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain('"display_sample":1234567890123456.78');
    expect(body).toContain('"value":1234567890123456.78');
    expect(body).toContain('"api_effect_type":"read"');
  });

  it("queries through the existing route with exact filter values and no implicit paging", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        new Response('{"entries":[{"amount":1234567890123456.78}]}'),
    );
    vi.stubGlobal("fetch", fetchMock);
    await cli().parseAsync(
      [
        ...base,
        "query",
        "r1",
        "--paging",
        "null",
        "--precise-numbers",
        "--filter",
        '{"operation":"eq","field":"amount","value":1234567890123456.78}',
      ],
      { from: "user" },
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/resources/r1/data");
    expect(init?.body).toContain('"value":1234567890123456.78');
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("paging");
    expect(
      vi
        .mocked(process.stdout.write)
        .mock.calls.map(([line]) => String(line))
        .join(""),
    ).toContain("1234567890123456.78");
  });

  it.each([
    "[]",
    "false",
    '{"cursor":"opaque"}',
    '{"limit":-1}',
    '{"mode":"cursor"}',
    '{"offset":9007199254740993}',
    '{"limit":9007199254740993}',
  ])("rejects invalid explicit paging before HTTP: %s", async (paging) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      cli().parseAsync([...base, "query", "r1", "--paging", paging], { from: "user" }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
