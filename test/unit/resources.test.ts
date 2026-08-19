import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureResourceIndex,
  createResource,
  createResourceDocuments,
  deleteResource,
  deleteResourceDocuments,
  deleteResourceDocumentsByFilter,
  findResource,
  getResourceDocument,
  listResources,
  queryResource,
  updateResource,
  upsertResourceDocument,
  upsertResourceDocuments,
} from "../../src/api/resources.js";
import type { RequestContext } from "../../src/types.js";
import { HttpError } from "../../src/utils/errors.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

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

describe("listResources", () => {
  it("maps list filters to vega-backend query params", async () => {
    const f = mockFetch();
    await listResources(ctx, {
      catalogId: "ds-1",
      category: "table",
      status: "active",
      schema: "app",
      limit: 10,
      offset: 20,
      includeExtensions: true,
      includeExtensionKeys: "owner",
      extensionPairs: [{ key: "owner", value: "data" }],
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
    expect(url.searchParams.get("include_extensions")).toBe("true");
    expect(url.searchParams.get("include_extension_keys")).toBe("owner");
    expect(url.searchParams.getAll("extension_key")).toEqual(["owner"]);
    expect(url.searchParams.getAll("extension_value")).toEqual(["data"]);
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

  it("rejects resource entries that do not satisfy the current protocol", async () => {
    mockFetch({ entries: [{ id: "r-1", name: "orders" }], total_count: 1 });
    await expect(listResources(ctx)).rejects.toThrow();
  });
});

describe("updateResource/configureResourceIndex", () => {
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
    await updateResource(ctx, "r-1", { indexConfig: { build_key_fields: ["id"] } });
    const calls = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
    expect(new URL(calls[1]?.[0] ?? "").pathname).toBe("/api/vega-backend/v1/resources/r-1");
    const body = JSON.parse(calls[1]?.[1].body as string);
    expect(body.name).toBe("orders");
    expect(body.catalog_id).toBe("c-1");
    expect(body).not.toHaveProperty("schema");
    expect(body).not.toHaveProperty("source_identifier");
    expect(body).not.toHaveProperty("source_metadata");
    expect(body.index_config).toEqual({ build_key_fields: ["id"] });
    expect(body.expected_update_time).toBe(1720000000123);
  });

  it("writes resource index_config and schema features for build intent", async () => {
    const f = mockFetch({
      entries: [
        resourceFixture({
          update_time: 1720000000456,
          schema_definition: [
            { name: "title", type: "text" },
            { name: "body", type: "text", features: [] },
          ],
        }),
      ],
    });
    await configureResourceIndex(ctx, "r-1", {
      buildKeyFields: ["id"],
      embeddingFields: ["title"],
      embeddingModel: "small-model-1",
      fulltextFields: ["body"],
      fulltextAnalyzer: "ik_max_word",
    });
    const calls = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
    const body = JSON.parse(calls[1]?.[1].body as string);
    expect(body.index_config).toEqual({
      build_key_fields: ["id"],
      default_embedding_model: "small-model-1",
      default_fulltext_analyzer: "ik_max_word",
    });
    expect(body.expected_update_time).toBe(1720000000456);
    expect(body.schema_definition[0].features[0]).toMatchObject({
      feature_type: "vector",
      ref_property: "title",
      config: { embedding_model: "small-model-1" },
    });
    expect(body.schema_definition[1].features[0]).toMatchObject({
      feature_type: "fulltext",
      ref_property: "body",
      config: { analyzer: "ik_max_word" },
    });
  });

  it("resolves a numeric embedding model id to the name the index config takes", async () => {
    const resource = {
      entries: [
        resourceFixture({
          schema_definition: [{ name: "title", type: "text" }],
        }),
      ],
    };
    const fn = vi.fn(async (input: string) =>
      new URL(input).pathname.startsWith("/api/mf-model-manager")
        ? new Response(JSON.stringify({ model_name: "text-embedding-v4" }), { status: 200 })
        : new Response(JSON.stringify(resource), { status: 200 }),
    );
    vi.stubGlobal("fetch", fn);
    await configureResourceIndex(ctx, "r-1", {
      embeddingFields: ["title"],
      embeddingModel: "2064382281006583808",
    });
    const calls = (fn as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
    const lookup = calls.find(([u]) => String(u).includes("/mf-model-manager"));
    expect(new URL(lookup?.[0] ?? "").searchParams.get("model_id")).toBe("2064382281006583808");
    const body = JSON.parse(calls.at(-1)?.[1].body as string);
    expect(body.index_config.default_embedding_model).toBe("text-embedding-v4");
    expect(body.schema_definition[0].features[0].config).toEqual({
      embedding_model: "text-embedding-v4",
    });
  });

  it("rejects an unknown embedding model id before touching the resource", async () => {
    const fn = vi.fn(async (input: string) =>
      new URL(input).pathname.startsWith("/api/mf-model-manager")
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify({ entries: [resourceFixture()] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fn);
    await expect(configureResourceIndex(ctx, "r-1", { embeddingModel: "999" })).rejects.toThrow(
      /No small model found with id 999/,
    );
    const methods = (fn as unknown as { mock: { calls: CallArgs[] } }).mock.calls.map(
      ([, init]) => init.method,
    );
    expect(methods).not.toContain("PUT");
  });

  it("keeps a gateway 404 as a routing failure, not as a bad-id InputError", async () => {
    const fn = vi.fn(async (input: string) =>
      new URL(input).pathname.startsWith("/api/mf-model-manager")
        ? new Response("<html><body>404 Not Found</body></html>", {
            status: 404,
            headers: { "content-type": "text/html" },
          })
        : new Response(JSON.stringify({ entries: [resourceFixture()] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fn);
    // A deploy without model-factory answers 404 too — but nothing behind the
    // route saw the id, so "you typed a bad id" is the wrong conclusion.
    const err = await configureResourceIndex(ctx, "r-1", { embeddingModel: "999" }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).gateway).toBe(true);
    expect((err as HttpError).hint).toMatch(/did not reach the service/);
  });

  it("keeps a model-factory auth failure as itself, not as a bad-id InputError", async () => {
    const fn = vi.fn(async (input: string) =>
      new URL(input).pathname.startsWith("/api/mf-model-manager")
        ? new Response(JSON.stringify({ error: "token expired" }), { status: 401 })
        : new Response(JSON.stringify({ entries: [resourceFixture()] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fn);
    // Exit code 3 (auth), not 2 (bad input) — "log in again" ≠ "you typed a wrong id".
    const err = await configureResourceIndex(ctx, "r-1", { embeddingModel: "999" }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(401);
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

  it("sends only the opaque cursor for a resource-data continuation", async () => {
    const f = mockFetch();
    await queryResource(ctx, "r-1", { cursor: "cursor-1" });
    expect(JSON.parse(firstCall(f)[1].body as string)).toEqual({
      paging: { cursor: "cursor-1" },
      need_total: false,
    });
  });
});

describe("typed Resource and document APIs", () => {
  it("creates a typed dataset resource", async () => {
    const f = mockFetch(resourceFixture({ category: "dataset" }));
    await expect(
      createResource(ctx, {
        catalogId: "c-1",
        name: "orders",
        category: "dataset",
        schemaDefinition: [{ name: "id", type: "string" }],
      }),
    ).resolves.toMatchObject({ id: "r-1", update_time: 2 });
    expect(JSON.parse(firstCall(f)[1].body as string)).toEqual({
      catalog_id: "c-1",
      name: "orders",
      category: "dataset",
      schema_definition: [{ name: "id", type: "string" }],
    });
  });

  it("supports batch create and upsert", async () => {
    const createFetch = mockFetch({ ids: ["d-1"] });
    await expect(createResourceDocuments(ctx, "r/1", [{ title: "created" }])).resolves.toEqual({
      ids: ["d-1"],
    });
    expect(new Headers(firstCall(createFetch)[1].headers).get("X-HTTP-Method-Override")).toBe(
      "POST",
    );
    expect(new URL(firstCall(createFetch)[0]).pathname).toContain("/resources/r%2F1/data");

    const upsertFetch = mockFetch({ ids: ["d-1"] });
    await upsertResourceDocuments(ctx, "r-1", [{ id: "d-1", title: "updated" }]);
    expect(firstCall(upsertFetch)[1].method).toBe("PUT");
    expect(JSON.parse(firstCall(upsertFetch)[1].body as string)).toEqual([
      { id: "d-1", title: "updated" },
    ]);
  });

  it("supports single get/upsert without rounding document bigint values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response('{"id":"d-1","account_id":110101199001152345}', { status: 200 }),
      ),
    );
    await expect(getResourceDocument(ctx, "r-1", "d-1")).resolves.toEqual({
      id: "d-1",
      account_id: 110101199001152345n,
    });

    const f = mockFetch({ id: "d-1" });
    await expect(upsertResourceDocument(ctx, "r-1", "d-1", { title: "updated" })).resolves.toEqual({
      id: "d-1",
    });
    expect(firstCall(f)[1].method).toBe("PUT");
  });

  it("deletes documents by encoded ids or a filter override", async () => {
    const idsFetch = mockFetch();
    await deleteResourceDocuments(ctx, "r-1", ["d/1", "d 2"]);
    expect(new URL(firstCall(idsFetch)[0]).pathname).toContain("/data/d%2F1,d%202");

    const filterFetch = mockFetch();
    await deleteResourceDocumentsByFilter(ctx, "r-1", { status: { eq: "stale" } });
    expect(new Headers(firstCall(filterFetch)[1].headers).get("X-HTTP-Method-Override")).toBe(
      "DELETE",
    );
    expect(JSON.parse(firstCall(filterFetch)[1].body as string)).toEqual({
      filter_condition: { status: { eq: "stale" } },
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
