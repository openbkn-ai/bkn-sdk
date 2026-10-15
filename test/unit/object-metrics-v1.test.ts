import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { createClient } from "../../src/client.js";
import { bknCommand } from "../../src/commands/bkn.js";

const BASE = "https://object-metrics.example.com";
const ROOT = "/api/bkn-backend/v1/knowledge-networks/kn-1/object-metrics";
const QUERY = "/api/ontology-query/v1/knowledge-networks/kn-1/object-metrics";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

function server(result: unknown) {
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (new URL(String(url)).pathname === "/api/bkn-backend/v1/health") {
      return Response.json({ ServerVersion: pkg.version });
    }
    return Response.json(result);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function calls(fetch: ReturnType<typeof vi.fn>) {
  return fetch.mock.calls.filter(([url]) => !String(url).includes("/health"));
}

describe("Object Metrics V1", () => {
  it("lists by owner and queries an explicit published version", async () => {
    const fetch = server({ entries: [], status: "ok", overall_ms: 1 });
    const client = createClient({ baseUrl: BASE, token: "t" });

    await client.kn.objectMetricList("kn-1", { ownerObjectTypeId: "orders", status: "published" });
    await client.kn.objectMetricQuery(
      "kn-1",
      "m-1",
      { instance_identities: [{ id: "a" }] },
      { version: 3 },
    );

    const [list, query] = calls(fetch);
    expect(new URL(String(list?.[0])).pathname).toBe(ROOT);
    expect(new URL(String(list?.[0])).searchParams.get("owner_object_type_id")).toBe("orders");
    expect(new URL(String(list?.[0])).searchParams.get("status")).toBe("published");
    expect(new URL(String(query?.[0])).pathname).toBe(`${QUERY}/m-1/data`);
    expect(new URL(String(query?.[0])).searchParams.get("version")).toBe("3");
    expect(JSON.parse(String(query?.[1]?.body))).toEqual({ instance_identities: [{ id: "a" }] });
  });

  it("rejects invalid versions before querying", () => {
    const fetch = server({});
    const client = createClient({ baseUrl: BASE, token: "t" });

    expect(() => client.kn.objectMetricQuery("kn-1", "m-1", {}, { version: 0 })).toThrow(
      "positive integer",
    );
    expect(calls(fetch)).toHaveLength(0);
  });

  it("rejects draft update when the body version differs from the requested version", () => {
    const fetch = server({});
    const client = createClient({ baseUrl: BASE, token: "t" });

    expect(() =>
      client.kn.objectMetricUpdate("kn-1", "m-1", { version: 2 }, { version: 3 }),
    ).toThrow("definition.version must match");
    expect(() => client.kn.objectMetricUpdate("kn-1", "m-1", {}, { version: 3 })).toThrow(
      "definition.version must match",
    );
    expect(calls(fetch)).toHaveLength(0);
  });

  it("creates a single draft and validates the V1 issue envelope", async () => {
    const result = {
      valid: false,
      issues: [{ code: "missing", field: "name", message: "Required" }],
      output_shape: "summary",
    };
    const fetch = server(result);
    const client = createClient({ baseUrl: BASE, token: "t" });

    await client.kn.objectMetricCreate("kn-1", { code: "orders" });
    await expect(client.kn.objectMetricValidate("kn-1", { code: "orders" })).resolves.toEqual(
      result,
    );
    const [create, validate] = calls(fetch);
    expect(new URL(String(create?.[0])).pathname).toBe(ROOT);
    expect(create?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(create?.[1]?.body))).toEqual({ code: "orders" });
    expect(new Headers(create?.[1]?.headers).get("X-HTTP-Method-Override")).toBeNull();
    expect(new URL(String(validate?.[0])).pathname).toBe(`${ROOT}/validate`);
  });

  it("rejects a malformed validation result", async () => {
    server({ valid: true });
    const client = createClient({ baseUrl: BASE, token: "t" });
    await expect(client.kn.objectMetricValidate("kn-1", {})).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("exposes a self-describing CLI and requires a query version", () => {
    const cli = new Command("openbkn").exitOverride().addCommand(bknCommand());
    const objectMetric = cli.commands[0]?.commands.find(
      (command) => command.name() === "object-metric",
    );
    const query = objectMetric?.commands.find((command) => command.name() === "query");
    expect(query).toBeDefined();
    expect(query?.options.find((option) => option.long === "--version")?.mandatory).toBe(true);
  });
});
