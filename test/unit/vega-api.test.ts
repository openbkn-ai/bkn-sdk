import { afterEach, describe, expect, it, vi } from "vitest";
import type { APICatalogConfig, APIDefinition } from "../../src/api/api-definition.js";
import {
  createResource,
  getResource,
  queryResource,
  updateResource,
} from "../../src/api/resources.js";
import { createCatalog, getCatalog } from "../../src/api/vega.js";
import type { RequestContext } from "../../src/types.js";
import { Decimal, parsePreciseJSON, stringifyBigIntJSON } from "../../src/utils/json-bigint.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://api.example.com",
  token: "t",
  insecure: false,
});
const definition = {
  request: { method: "GET", path: "/records" },
  response: {
    content_type: "application/json" as const,
    statuses: { "200": { description: "Rows", schema: { type: "array" }, result_rows: "" } },
  },
  success_rule: { http_status: [200] },
};
const current = {
  id: "r1",
  catalog_id: "c1",
  name: "records",
  category: "api",
  status: "active",
  enabled: true,
  source_identifier: "r1",
  creator: { id: "u", type: "user" },
  updater: { id: "u", type: "user" },
  create_time: 1,
  update_time: 2,
  api_effect_type: "read",
  api_definition: definition,
};
afterEach(() => vi.unstubAllGlobals());

describe("API consumers", () => {
  it("preserves decimal numbers without rounding", () => {
    const data = parsePreciseJSON(
      '{"amount":1234567890123456.78,"id":9007199254740993,"text":"00123","exp":1.234e100000}',
    ) as Record<string, unknown>;
    expect(data.amount).toBeInstanceOf(Decimal);
    expect(String(data.amount)).toBe("1234567890123456.78");
    expect(data.id).toBe(9007199254740993n);
    expect(() => Number(data.amount)).toThrow();
    expect(stringifyBigIntJSON(data)).toBe(
      '{"amount":1234567890123456.78,"id":9007199254740993,"text":"00123","exp":1.234e100000}',
    );
  });

  it("accepts omitted, null and explicit variable sensitivity for Catalogs and Resources", async () => {
    const variables = {
      omitted: { value: "east" },
      nullable: { value: "east", sensitive: null },
      public: { value: "east", sensitive: false },
      protected: { value: "sample-private-value", sensitive: true },
    };
    const config: APICatalogConfig = { base_url: "https://upstream.example.com", variables };
    const apiDefinition: APIDefinition = { ...definition, variables };
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) => new Response('{"id":"created"}'),
    );
    vi.stubGlobal("fetch", fetchMock);
    await createCatalog(ctx, { name: "API", connectorType: "http", connectorConfig: config });
    await createResource(ctx, {
      catalogId: "c1",
      name: "records",
      category: "api",
      apiEffectType: "read",
      apiDefinition,
      schemaDefinition: [{ name: "id", type: "string", filterable: true }],
    });
    const catalogBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const resourceBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    for (const sent of [
      catalogBody.connector_config.variables,
      resourceBody.api_definition.variables,
    ]) {
      expect(sent).toEqual(variables);
      expect(sent.omitted).not.toHaveProperty("sensitive");
      expect(sent.nullable.sensitive).toBeNull();
    }
  });

  it("creates API definitions with transient validation and complete schema metadata", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) => new Response('{"id":"r1"}'),
    );
    vi.stubGlobal("fetch", fetchMock);
    await createResource(ctx, {
      catalogId: "c1",
      name: "records",
      category: "api",
      apiEffectType: "read",
      apiDefinition: definition,
      schemaDefinition: [
        {
          name: "amount",
          type: "decimal",
          filterable: true,
          attributes: {
            precision: 18,
            scale: 2,
            display_sample: new Decimal("1234567890123456.78"),
          },
        },
      ],
      validation: {
        filter_condition: {
          field: "amount",
          operation: "eq",
          value: new Decimal("1234567890123456.78"),
        },
        paging: { limit: 3 },
      },
    });
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain('"display_sample":1234567890123456.78');
    expect(body).toContain('"api_effect_type":"read"');
    expect(JSON.parse(body).validation.paging).toEqual({ limit: 3 });
  });

  it("omits API pagination and preserves fractional response numbers explicitly", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        new Response(
          '{"entries":[{"id":9007199254740993,"amount":1234567890123456.78}],"query_source":"source","is_approximate":false}',
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await queryResource(ctx, "r1", {
      paging: null,
      preciseNumbers: true,
      filterCondition: { operation: "eq", field: "id", value: 9007199254740993n },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty("paging");
    expect(result.entries[0]?.amount).toBeInstanceOf(Decimal);
    expect(result.entries[0]?.id).toBe(9007199254740993n);
  });

  it("updates API metadata without resending definitions or schema", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Response(init?.method === "PUT" ? "{}" : JSON.stringify({ entries: [current] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await updateResource(ctx, "r1", { name: "renamed" });
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body.api_effect_type).toBe("read");
    expect(body).not.toHaveProperty("api_definition");
    expect(body).not.toHaveProperty("schema_definition");
  });

  it("preserves complete API definitions and unknown schema metadata through read and replacement", async () => {
    const saved = {
      ...current,
      api_definition: { ...definition, variables: { threshold: { value: 0, sensitive: false } } },
      schema_definition: [
        {
          name: "amount",
          type: "decimal",
          filterable: true,
          attributes: { precision: 18, scale: 2 },
          external_metadata: { amount: new Decimal("1234567890123456.78"), label: "raw" },
        },
      ],
    };
    const fetchMock = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Response(init?.method === "PUT" ? "{}" : stringifyBigIntJSON({ entries: [saved] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await getResource(ctx, "r1", { preciseNumbers: true });
    const resource = result.entries[0]!;
    expect(resource.api_definition).toEqual(saved.api_definition);
    await updateResource(ctx, "r1", {
      apiDefinition: resource.api_definition!,
      schemaDefinition: resource.schema_definition as NonNullable<
        Parameters<typeof updateResource>[2]["schemaDefinition"]
      >,
    });
    const wire = String(fetchMock.mock.calls[2]?.[1]?.body);
    expect(wire).toContain('"external_metadata":{"amount":1234567890123456.78,"label":"raw"}');
    expect(JSON.parse(wire).api_definition.response.statuses["200"].result_rows).toBe("");
    expect(JSON.parse(wire)).not.toHaveProperty("validation");
  });

  it("makes Catalog precision opt-in without changing existing number results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '{"entries":[{"id":"c","name":"API","type":"physical","enabled":true,"connector_type":"http","category":"api","connector_config":{"base_url":"https://upstream.example.com","variables":{"amount":{"value":1234567890123456.78,"sensitive":false},"integer":{"value":9007199254740993,"sensitive":false}}}}]}',
          ),
      ),
    );
    const exact = await getCatalog(ctx, "c", { preciseNumbers: true });
    const variables = exact.entries[0]?.connector_config?.variables as Record<
      string,
      { value: unknown }
    >;
    expect(variables.amount?.value).toBeInstanceOf(Decimal);
    expect(variables.integer?.value).toBe(9007199254740993n);
    const legacy = await getCatalog(ctx, "c");
    const legacyVariables = legacy.entries[0]?.connector_config?.variables as Record<
      string,
      { value: unknown }
    >;
    expect(typeof legacyVariables.amount?.value).toBe("number");
    expect(typeof legacyVariables.integer?.value).toBe("number");
    const disabled = await getCatalog(ctx, "c", { preciseNumbers: false });
    const disabledVariables = disabled.entries[0]?.connector_config?.variables as Record<
      string,
      { value: unknown }
    >;
    expect(typeof disabledVariables.integer?.value).toBe("number");
  });

  it.each(["dataset", "logical_view"])(
    "keeps fixed Resource numbers compatible and copies exact definitions on a %s update",
    async (category) => {
      const saved = {
        ...current,
        category,
        api_definition: undefined,
        column_count: new Decimal("2e1"),
        index_config: { default_keyword_ignore_above: new Decimal("256.0") },
        schema_definition: [
          {
            name: "amount",
            type: "decimal",
            filterable: true,
            attributes: { sample: new Decimal("1234567890123456.78") },
          },
        ],
        ...(category === "logical_view"
          ? {
              logical_type: "derived",
              logical_view_definition: {
                source_resource_id: "source",
                filter_condition: {
                  field: "amount",
                  operation: "eq",
                  value: new Decimal("9007199254740993.125"),
                },
              },
            }
          : {}),
      };
      const fetchMock = vi.fn(
        async (_url: unknown, init?: RequestInit) =>
          new Response(init?.method === "PUT" ? "{}" : stringifyBigIntJSON({ entries: [saved] })),
      );
      vi.stubGlobal("fetch", fetchMock);

      await updateResource(ctx, "r1", { name: "renamed" });

      expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PUT"]);
      const wire = String(fetchMock.mock.calls[1]?.[1]?.body);
      expect(wire).toContain('"default_keyword_ignore_above":256}');
      expect(wire).toContain('"sample":1234567890123456.78');
      if (category === "logical_view") expect(wire).toContain('"value":9007199254740993.125');
    },
  );

  it.each(["table"])("omits unchanged schema on a metadata-only %s update", async (category) => {
    const saved = {
      ...current,
      category,
      schema_definition: [
        {
          name: "id",
          filterable: true,
          attributes: { source_label: "original" },
        },
      ],
    };
    const fetchMock = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Response(init?.method === "PUT" ? "{}" : JSON.stringify({ entries: [saved] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await updateResource(ctx, "r1", { name: "renamed" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).not.toHaveProperty(
      "schema_definition",
    );
  });

  it.each(["offset", "limit"] as const)("rejects unsafe SDK %s before HTTP", (field) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(() =>
      queryResource(ctx, "r1", { paging: { [field]: Number.MAX_SAFE_INTEGER + 1 } }),
    ).toThrow("paging");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects destination and credential overrides in save-time validation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createResource(ctx, {
        catalogId: "c",
        name: "d",
        category: "api",
        apiEffectType: "read",
        apiDefinition: definition,
        schemaDefinition: [{ name: "id", type: "integer" }],
        validation: { base_url: "https://other.example.com", token: "example" } as never,
      }),
    ).rejects.toThrow("validation");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
