import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type ResourceSummary,
  createResource,
  createResourceDocument,
  deleteResource,
  deleteResourceDocuments,
  deleteResourceDocumentsByFilter,
  deleteResourceDocumentsBySelector,
  disableResource,
  enableResource,
  findResource,
  firstResource,
  getResource,
  getResourceDocuments,
  listResources,
  queryResource,
  updateResource,
  upsertResourceDocument,
} from "../../src/api/resources.js";
import type { ResourceIndexConfig, ResourceLocalStatus } from "../../src/index.js";
import type { RequestContext } from "../../src/types.js";
import { InputError } from "../../src/utils/errors.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

type CallArgs = [string, RequestInit];

function mockFetch(body: unknown = { entries: [], total_count: 0 }): typeof fetch {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function resourceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    catalog_id: "c-1",
    name: "orders",
    category: "table",
    status: "active",
    enabled: true,
    local_status: "unavailable",
    source_identifier: "orders",
    creator: { id: "u-1", type: "user" },
    create_time: 1,
    updater: { id: "u-1", type: "user" },
    update_time: 2,
    ...overrides,
  };
}
function firstCall(fetchMock: typeof fetch): CallArgs {
  const args = (fetchMock as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!args) throw new Error("fetch not called");
  return args;
}

afterEach(() => vi.unstubAllGlobals());

describe("ResourceLocalStatus", () => {
  it("is exported from the SDK entry point", () => {
    expectTypeOf<ResourceLocalStatus>().toEqualTypeOf<"unavailable" | "available" | "stale">();
    expectTypeOf<ResourceIndexConfig["default_keyword_ignore_above"]>().toEqualTypeOf<
      number | undefined
    >();
  });
});

describe("listResources", () => {
  it("keeps summary responses forward-compatible without exposing detail-field types", async () => {
    expectTypeOf<ResourceSummary["source_metadata"]>().toEqualTypeOf<unknown>();
    expectTypeOf<ResourceSummary["schema_definition"]>().toEqualTypeOf<unknown>();
    expectTypeOf<ResourceSummary["index_config"]>().toEqualTypeOf<unknown>();
    expectTypeOf<ResourceSummary["logic_definition"]>().toEqualTypeOf<unknown>();

    mockFetch({
      entries: [
        resourceFixture({
          future_field: "preserved",
          index_config: { primary_key_fields: ["id"], incremental_fields: ["updated_at"] },
          source_metadata: { properties: { row_count: 1 } },
        }),
      ],
      total_count: 1,
    });

    await expect(listResources(ctx)).resolves.toMatchObject({
      entries: [
        {
          future_field: "preserved",
          index_config: { primary_key_fields: ["id"], incremental_fields: ["updated_at"] },
          source_metadata: { properties: { row_count: 1 } },
        },
      ],
    });
  });

  it("maps list filters to vega-backend query params", async () => {
    const f = mockFetch();
    await listResources(ctx, {
      catalogId: "ds-1",
      category: "table",
      status: "active",
      schema: "app",
      limit: 10,
      offset: 20,
      sort: "name",
      direction: "asc",
    });
    const url = new URL(firstCall(f)[0]);
    expect(url.pathname).toBe("/api/vega-backend/v1/resources");
    expect(url.searchParams.get("catalog_id")).toBe("ds-1");
    expect(url.searchParams.get("category")).toBe("table");
    expect(url.searchParams.get("status")).toBe("active");
    expect(url.searchParams.get("schema")).toBe("app");
    expect(url.searchParams.has("database")).toBe(false);
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("offset")).toBe("20");
    expect(url.searchParams.get("sort")).toBe("name");
    expect(url.searchParams.get("direction")).toBe("asc");
  });

  it("forwards limit=-1 (NO_LIMIT) to fetch every row", async () => {
    const f = mockFetch();
    await listResources(ctx, { catalogId: "ds-1", limit: -1 });
    expect(new URL(firstCall(f)[0]).searchParams.get("limit")).toBe("-1");
  });

  it("uses the SDK default for non-finite / zero limits", async () => {
    const f = mockFetch();
    await listResources(ctx, { limit: Number.NaN });
    expect(new URL(firstCall(f)[0]).searchParams.get("limit")).toBe("30");
  });

  it("requires resource identity fields while accepting future enum values", async () => {
    mockFetch({ entries: [{ id: "r-1", name: "orders" }], total_count: 1 });
    await expect(listResources(ctx)).rejects.toThrow();

    mockFetch({ entries: [resourceFixture({ name: "" })], total_count: 1 });
    await expect(listResources(ctx)).rejects.toThrow();

    mockFetch({
      entries: [
        resourceFixture({ category: "warehouse", status: "archived", logic_type: "materialized" }),
      ],
      total_count: 1,
    });
    await expect(listResources(ctx)).resolves.toMatchObject({
      entries: [{ category: "warehouse", status: "archived", logic_type: "materialized" }],
    });

    mockFetch({ entries: [resourceFixture({ local_status: "unknown" })], total_count: 1 });
    await expect(listResources(ctx)).rejects.toThrow();
  });

  it("reads a resource from a deploy that reports no local status", async () => {
    // Neither reference deploy sends the key. Requiring it rejected every
    // resource read against both, while the fixtures here carried it and so
    // said nothing about that.
    const { local_status: _omitted, ...withoutLocalStatus } = resourceFixture();
    mockFetch({ entries: [withoutLocalStatus], total_count: 1 });
    await expect(listResources(ctx)).resolves.toMatchObject({ entries: [{ id: "r-1" }] });
  });

  it("rejects an empty resource detail envelope", () => {
    expect(() => firstResource({ entries: [] })).toThrow(
      "resource detail response contains no entries",
    );
  });
});

describe("updateResource", () => {
  it("merges required resource fields before PUT update", async () => {
    const f = mockFetch({
      entries: [
        resourceFixture({
          update_time: 1720000000123,
          schema: "sales",
          schema_definition: [{ name: "title", type: "text" }],
        }),
      ],
    });
    await updateResource(ctx, "r-1", {
      indexConfig: {
        primary_key_fields: ["id"],
        incremental_fields: ["updated_at"],
        default_keyword_ignore_above: 512,
      },
    });
    const calls = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
    expect(new URL(calls[1]?.[0] ?? "").pathname).toBe("/api/vega-backend/v1/resources/r-1");
    const body = JSON.parse(calls[1]?.[1].body as string);
    expect(body.name).toBe("orders");
    expect(body.catalog_id).toBe("c-1");
    expect(body.enabled).toBe(true);
    expect(body).not.toHaveProperty("schema");
    expect(body).not.toHaveProperty("source_identifier");
    expect(body).not.toHaveProperty("source_metadata");
    expect(body.index_config).toEqual({
      primary_key_fields: ["id"],
      incremental_fields: ["updated_at"],
      default_keyword_ignore_above: 512,
    });
    expect(body.expected_update_time).toBe(1720000000123);
  });

  it("strips the server-written vector dimension from both the read schema and a patch", async () => {
    const vector = (dimension: number) => ({
      feature_type: "vector",
      name: "emb",
      config: { embedding_model: "m-1", dimension },
    });
    const keyword = { feature_type: "keyword", name: "kw", config: { ignore_above: 256 } };
    const f = mockFetch({
      entries: [
        resourceFixture({
          schema_definition: [{ name: "body", type: "text", features: [vector(768), keyword] }],
        }),
      ],
    });
    await updateResource(ctx, "r-1", { name: "renamed" });
    await updateResource(ctx, "r-1", {
      schemaDefinition: [{ name: "body", type: "text", features: [vector(1024)] }],
    });
    const calls = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
    const echoed = JSON.parse(calls[1]?.[1].body as string);
    expect(echoed.schema_definition[0].features).toEqual([
      { feature_type: "vector", name: "emb", config: { embedding_model: "m-1" } },
      keyword,
    ]);
    const patched = JSON.parse(calls[3]?.[1].body as string);
    expect(patched.schema_definition[0].features).toEqual([
      { feature_type: "vector", name: "emb", config: { embedding_model: "m-1" } },
    ]);
  });

  it("uses action endpoints for independent enabled state", async () => {
    const f = mockFetch();
    await enableResource(ctx, "r/1");
    await disableResource(ctx, "r 2");
    const requestCalls = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
    expect(new URL(requestCalls[0]?.[0] ?? "").pathname).toBe(
      "/api/vega-backend/v1/resources/r%2F1/enable",
    );
    expect(new URL(requestCalls[1]?.[0] ?? "").pathname).toBe(
      "/api/vega-backend/v1/resources/r%202/disable",
    );
  });
});

describe("queryResource", () => {
  it("preserves an unsafe BIGINT response value as native bigint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"entries":[{"id_card":110101199001152345,"safe_id":42}]}', {
            status: 200,
          }),
      ),
    );

    await expect(queryResource(ctx, "r-1")).resolves.toEqual({
      entries: [{ id_card: 110101199001152345n, safe_id: 42 }],
    });
  });

  it("POSTs to /data with the paging contract and GET override", async () => {
    const f = mockFetch();
    await queryResource(ctx, "r-1", { limit: 5, offset: 2, needTotal: true });
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/vega-backend/v1/resources/r-1/data");
    expect(call[1].method).toBe("POST");
    expect(new Headers(call[1].headers).get("X-HTTP-Method-Override")).toBe("GET");
    expect(JSON.parse(call[1].body as string)).toEqual({
      paging: { mode: "single", limit: 5, offset: 2 },
      need_total: true,
    });
  });

  it("sends binary_mode and ignore_local_index on the initial request", async () => {
    const f = mockFetch();
    await queryResource(ctx, "r-1", { binaryMode: "content", ignoreLocalIndex: true });
    expect(JSON.parse(firstCall(f)[1].body as string)).toMatchObject({
      binary_mode: "content",
      ignore_local_index: true,
    });
  });

  it("sends only the opaque cursor for a resource-data continuation", async () => {
    const f = mockFetch();
    await queryResource(ctx, "r-1", {
      cursor: "cursor-1",
      binaryMode: "content",
      ignoreLocalIndex: true,
    });
    expect(JSON.parse(firstCall(f)[1].body as string)).toEqual({
      paging: { cursor: "cursor-1" },
      need_total: false,
    });
  });
});

describe("typed Resource and document APIs", () => {
  it("creates a typed dataset resource", async () => {
    const f = mockFetch({ id: "r-1" });
    await expect(
      createResource(ctx, {
        catalogId: "c-1",
        name: "orders",
        category: "dataset",
        schemaDefinition: [{ name: "id", type: "string" }],
      }),
    ).resolves.toEqual({ id: "r-1" });
    expect(JSON.parse(firstCall(f)[1].body as string)).toEqual({
      catalog_id: "c-1",
      name: "orders",
      category: "dataset",
      schema_definition: [{ name: "id", type: "string" }],
    });
  });

  it("creates and upserts a single document", async () => {
    const createFetch = mockFetch({ id: "d-1" });
    await expect(createResourceDocument(ctx, "r/1", { title: "created" })).resolves.toEqual({
      id: "d-1",
    });
    expect(new Headers(firstCall(createFetch)[1].headers).get("X-HTTP-Method-Override")).toBe(
      "POST",
    );
    expect(new URL(firstCall(createFetch)[0]).pathname).toContain("/resources/r%2F1/data");

    const upsertFetch = mockFetch({ id: "d-1" });
    await upsertResourceDocument(ctx, "r-1", "d-1", { title: "updated" });
    expect(firstCall(upsertFetch)[1].method).toBe("PUT");
    expect(new URL(firstCall(upsertFetch)[0]).pathname).toContain("/data/d-1");
    expect(JSON.parse(firstCall(upsertFetch)[1].body as string)).toEqual({ title: "updated" });

    await expect(upsertResourceDocument(ctx, "r-1", "d-1,d-2", {})).rejects.toThrow(InputError);

    const guarded = mockFetch({ id: "d-2" });
    await expect(createResourceDocument(ctx, "r-1", { _id: "chosen", title: "x" })).rejects.toThrow(
      /_id/,
    );
    expect((guarded as unknown as { mock: { calls: CallArgs[] } }).mock.calls).toHaveLength(0);
  });

  it("gets documents without rounding bigint values", async () => {
    const getFetch = vi.fn(
      async (_input: string) =>
        new Response('{"entries":[{"id":"d-1","account_id":110101199001152345}]}', { status: 200 }),
    );
    vi.stubGlobal("fetch", getFetch);
    await expect(
      getResourceDocuments(ctx, "r-1", ["d-1", "d-2"], { ignoreMissing: true }),
    ).resolves.toEqual([{ id: "d-1", account_id: 110101199001152345n }]);
    const url = new URL(String(getFetch.mock.calls[0]?.[0]));
    expect(url.pathname).toContain("/data/d-1,d-2");
    expect(url.searchParams.get("ignore_missing")).toBe("true");
  });

  it("deletes documents by encoded ids or a filter", async () => {
    const idsFetch = mockFetch();
    await deleteResourceDocuments(ctx, "r-1", ["d/1", "d 2"], { ignoreMissing: true });
    expect(new URL(firstCall(idsFetch)[0]).pathname).toContain("/data/d%2F1,d%202");
    expect(new URL(firstCall(idsFetch)[0]).searchParams.get("ignore_missing")).toBe("true");

    const filterFetch = mockFetch();
    await deleteResourceDocumentsBySelector(ctx, "r-1", { kind: "remove", state: "stale" });
    expect(new Headers(firstCall(filterFetch)[1].headers).get("X-HTTP-Method-Override")).toBe(
      "DELETE",
    );
    expect(JSON.parse(firstCall(filterFetch)[1].body as string)).toEqual({
      filter_condition: {
        operation: "and",
        sub_conditions: [
          { field: "kind", operation: "eq", value: "remove", value_from: "const" },
          { field: "state", operation: "eq", value: "stale", value_from: "const" },
        ],
      },
    });
  });

  it("normalizes document ids and rejects an empty result before requesting", async () => {
    const getFetch = mockFetch({ entries: [] });
    await getResourceDocuments(ctx, "r-1", [" d-1 ", "", "d-1", "d-2,d-1"]);
    expect(new URL(firstCall(getFetch)[0]).pathname).toContain("/data/d-1,d-2");

    const deleteFetch = mockFetch();
    await expect(deleteResourceDocuments(ctx, "r-1", [" ", ""])).rejects.toThrow(InputError);
    expect(deleteFetch).not.toHaveBeenCalled();
  });

  it("rejects an empty document deletion filter before making a request", async () => {
    const filterFetch = mockFetch();
    await expect(deleteResourceDocumentsByFilter(ctx, "r-1", {})).rejects.toThrow(InputError);
    expect(filterFetch).not.toHaveBeenCalled();
  });

  it("preserves a valid Vega filter condition", async () => {
    const filterFetch = mockFetch();
    const condition = { field: "kind", operation: "eq", value: "remove", value_from: "const" };
    await deleteResourceDocumentsByFilter(ctx, "r-1", condition);
    expect(JSON.parse(firstCall(filterFetch)[1].body as string)).toEqual({
      filter_condition: condition,
    });
  });

  it("converts selector fields that overlap Vega filter keys", async () => {
    const filterFetch = mockFetch();
    await deleteResourceDocumentsBySelector(ctx, "r-1", { value: "remove", operation: "remove" });

    expect(JSON.parse(firstCall(filterFetch)[1].body as string)).toEqual({
      filter_condition: {
        operation: "and",
        sub_conditions: [
          { field: "value", operation: "eq", value: "remove", value_from: "const" },
          { field: "operation", operation: "eq", value: "remove", value_from: "const" },
        ],
      },
    });
  });
});

describe("deleteResource", () => {
  it("DELETEs by ids with ignore_missing", async () => {
    const f = mockFetch({});
    await deleteResource(ctx, ["r 9", "r-10"], { ignoreMissing: true });
    const call = firstCall(f);
    expect(call[1].method).toBe("DELETE");
    const url = new URL(call[0]);
    expect(url.pathname).toBe("/api/vega-backend/v1/resources/r%209,r-10");
    expect(url.searchParams.get("ignore_missing")).toBe("true");
  });
});

describe("findResource", () => {
  it("returns resource summaries", () => {
    expectTypeOf<Awaited<ReturnType<typeof findResource>>>().toEqualTypeOf<ResourceSummary[]>();
  });

  it("filters to exact name when --exact", async () => {
    mockFetch({
      entries: [
        resourceFixture({ name: "orders" }),
        resourceFixture({ id: "r-2", name: "orders_archive" }),
      ],
      total_count: 2,
    });
    const exact = (await findResource(ctx, "orders", { exact: true })) as Array<{ name: string }>;
    expect(exact).toHaveLength(1);
    expect(exact[0]).toMatchObject({ name: "orders" });
  });
  it("returns all fuzzy matches by default", async () => {
    mockFetch({
      entries: [
        resourceFixture({ name: "orders" }),
        resourceFixture({ id: "r-2", name: "orders_archive" }),
      ],
      total_count: 2,
    });
    const fuzzy = (await findResource(ctx, "orders")) as Array<{ name: string }>;
    expect(fuzzy).toHaveLength(2);
  });
});

describe("absent collections arriving as null", () => {
  // Captured from a live deploy: the backend omits nothing, so a property with
  // no features, no attributes and a feature with no config sends each as
  // `null`. Every one of the 368 resources there carries at least one.
  const wireProperty = {
    name: "slice_content",
    type: "text",
    attributes: null,
    features: [{ name: "slice_content_fulltext", feature_type: "fulltext", config: null }],
  };

  it("reads a resource whose property collections are null", async () => {
    mockFetch({
      entries: [
        resourceFixture({
          schema_definition: [wireProperty, { ...wireProperty, name: "body", features: null }],
        }),
      ],
    });
    const parsed = firstResource(await getResource(ctx, "r-1"));
    const [first, second] = parsed.schema_definition ?? [];
    // `undefined`, not `null`: callers reach for these through `?? []` and `?.`,
    // and null would survive both.
    expect(second?.features).toBeUndefined();
    expect(first?.attributes).toBeUndefined();
    expect(first?.features?.[0]?.config).toBeUndefined();
    expect(first?.features).toHaveLength(1);
  });

  it("still rejects a property whose features are the wrong shape", async () => {
    // Reading null as absent must not turn the schema into a rubber stamp.
    mockFetch({
      entries: [resourceFixture({ schema_definition: [{ name: "title", features: 42 }] })],
    });
    await expect(getResource(ctx, "r-1")).rejects.toThrow();
  });
});
