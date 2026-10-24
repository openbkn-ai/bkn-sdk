import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { createClient } from "../../src/client.js";
import { bknCommand } from "../../src/commands/bkn.js";
import { guideOf } from "../../src/help/grouped-help.js";

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
    const fetch = server({
      model: {},
      entries: [],
      status: "ok",
      total_count: 0,
      overall_ms: 1,
      evaluated_at: 1_761_264_000_000,
    });
    const client = createClient({ baseUrl: BASE, token: "t" });

    await client.kn.objectMetricList("kn-1", { ownerObjectTypeId: "orders", status: "published" });
    await client.kn.objectMetricQuery(
      "kn-1",
      "m-1",
      {
        instance_identities: [{ id: "a" }],
        filter: {
          node_type: "group",
          boolean_operator: "not",
          children: [
            {
              node_type: "predicate",
              left: {
                source: "property",
                property_ref: { object_type_id: "orders", property_name: "cancelled_at" },
              },
              comparison_operator: "is_null",
            },
          ],
        },
        group_by: [{ object_type_id: "orders", property_name: "channel" }],
      },
      { version: 3 },
    );

    const [list, query] = calls(fetch);
    expect(new URL(String(list?.[0])).pathname).toBe(ROOT);
    expect(new URL(String(list?.[0])).searchParams.get("owner_object_type_id")).toBe("orders");
    expect(new URL(String(list?.[0])).searchParams.get("status")).toBe("published");
    expect(new URL(String(query?.[0])).pathname).toBe(`${QUERY}/m-1/data`);
    expect(new URL(String(query?.[0])).searchParams.get("version")).toBe("3");
    expect(JSON.parse(String(query?.[1]?.body))).toMatchObject({
      instance_identities: [{ id: "a" }],
      group_by: [{ object_type_id: "orders", property_name: "channel" }],
      filter: { node_type: "group", boolean_operator: "not" },
    });
  });

  it("covers the current authoring and drill-through routes", async () => {
    const fetch = server({});
    const client = createClient({ baseUrl: BASE, token: "t" });

    await client.kn.objectMetricCapabilities();
    await client.kn.objectMetricPreview("kn-1", { id: "m-1" }, { branch: "dev" });
    await client.kn.objectMetricDeletionCheck("kn-1", "m-1", {
      branch: "dev",
      version: 3,
    });
    await client.kn.objectMetricBindLogicProperty(
      "kn-1",
      "m-1",
      {
        object_type_id: "orders",
        property_name: "gmv",
        display_name: "GMV",
      },
      { branch: "dev", version: 3 },
    );
    await client.kn.objectMetricUpgradeLogicProperty("kn-1", "m-1", "gmv/current", {
      branch: "dev",
      version: 4,
    });

    const requestCalls = calls(fetch);
    expect(new URL(String(requestCalls[0]?.[0])).pathname).toBe(
      "/api/bkn-backend/v1/object-metrics/capabilities",
    );
    expect(new URL(String(requestCalls[1]?.[0])).pathname).toBe(`${ROOT}/preview`);
    expect(new URL(String(requestCalls[2]?.[0])).pathname).toBe(`${ROOT}/m-1/deletion-check`);
    expect(new URL(String(requestCalls[2]?.[0])).searchParams.get("version")).toBe("3");
    expect(new URL(String(requestCalls[3]?.[0])).pathname).toBe(`${ROOT}/m-1/logic-properties`);
    expect(JSON.parse(String(requestCalls[3]?.[1]?.body))).toEqual({
      object_type_id: "orders",
      property_name: "gmv",
      display_name: "GMV",
    });
    expect(new URL(String(requestCalls[4]?.[0])).pathname).toBe(
      `${ROOT}/m-1/logic-properties/gmv%2Fcurrent/metric-ref`,
    );
  });

  it("parses published and trial participant drill-through results", async () => {
    const result = {
      participants: [{ instance_identity: { id: "o-1" }, role: "contributor" }],
      evaluated_at: 1_761_264_000_000,
      status: "ok",
    };
    const fetch = server(result);
    const client = createClient({ baseUrl: BASE, token: "t" });
    const body = { query: {}, bucket_key: "bucket-1", page_size: 20 };

    await expect(
      client.kn.objectMetricDrillThrough("kn-1", "m-1", body, {
        branch: "dev",
        version: 3,
      }),
    ).resolves.toEqual(result);
    await expect(
      client.kn.objectMetricTrialDrillThrough(
        "kn-1",
        { ...body, definition: { id: "m-1" } },
        {
          branch: "dev",
        },
      ),
    ).resolves.toEqual(result);

    const [published, trial] = calls(fetch);
    expect(new URL(String(published?.[0])).pathname).toBe(`${QUERY}/m-1/data/drill-through`);
    expect(new URL(String(published?.[0])).searchParams.get("branch")).toBe("dev");
    expect(new URL(String(published?.[0])).searchParams.get("version")).toBe("3");
    expect(new URL(String(trial?.[0])).pathname).toBe(`${QUERY}/trial/drill-through`);
    expect(new URL(String(trial?.[0])).searchParams.get("branch")).toBe("dev");
  });

  it("rejects malformed query and drill-through envelopes", async () => {
    const client = createClient({ baseUrl: BASE, token: "t" });
    server({ status: "ok" });

    await expect(
      client.kn.objectMetricQuery("kn-1", "m-1", {}, { version: 1 }),
    ).rejects.toMatchObject({
      name: "ZodError",
    });
    await expect(
      client.kn.objectMetricDrillThrough(
        "kn-1",
        "m-1",
        { query: {}, bucket_key: "bucket-1" },
        { version: 1 },
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  it("rejects an unknown result action", async () => {
    server({
      model: {},
      entries: [{ status: "ok", available_actions: ["invented"] }],
      status: "ok",
      total_count: 1,
      overall_ms: 1,
      evaluated_at: 1_761_264_000_000,
    });
    const client = createClient({ baseUrl: BASE, token: "t" });

    await expect(
      client.kn.objectMetricQuery("kn-1", "m-1", {}, { version: 1 }),
    ).rejects.toMatchObject({ name: "ZodError" });
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
    const list = objectMetric?.commands.find((command) => command.name() === "list");
    expect(query).toBeDefined();
    expect(query?.options.find((option) => option.long === "--metric-version")?.mandatory).toBe(
      true,
    );
    expect(list?.description()).toContain("one page");
    const metricGuide = objectMetric ? guideOf(objectMetric) : undefined;
    expect(metricGuide).toContain("total_count");
    expect(metricGuide).toContain("--offset");
  });
});
