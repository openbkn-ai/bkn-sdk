import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureResourceIndex,
  deleteResource,
  findResource,
  listResources,
  queryResource,
  updateResource,
} from "../../src/api/resources.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

type CallArgs = [string, RequestInit];

function mockFetch(body: unknown = { entries: [] }): typeof fetch {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
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
      datasourceId: "ds-1",
      category: "table",
      status: "active",
      database: "app",
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
    expect(url.searchParams.get("database")).toBe("app");
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
    await listResources(ctx, { datasourceId: "ds-1", limit: -1 });
    expect(new URL(firstCall(f)[0]).searchParams.get("limit")).toBe("-1");
  });

  it("drops non-finite / zero limit so the backend default applies", async () => {
    const f = mockFetch();
    await listResources(ctx, { limit: Number.NaN });
    expect(new URL(firstCall(f)[0]).searchParams.has("limit")).toBe(false);
  });
});

describe("updateResource/configureResourceIndex", () => {
  it("merges required resource fields before PUT update", async () => {
    const f = mockFetch({
      entries: [
        {
          id: "r-1",
          catalog_id: "c-1",
          name: "orders",
          category: "table",
          status: "active",
          source_identifier: "orders",
          schema_definition: [{ name: "title", type: "text" }],
        },
      ],
    });
    await updateResource(ctx, "r-1", { indexConfig: { build_key_fields: ["id"] } });
    const calls = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
    expect(new URL(calls[1]?.[0] ?? "").pathname).toBe("/api/vega-backend/v1/resources/r-1");
    const body = JSON.parse(calls[1]?.[1].body as string);
    expect(body.name).toBe("orders");
    expect(body.catalog_id).toBe("c-1");
    expect(body.index_config).toEqual({ build_key_fields: ["id"] });
  });

  it("writes resource index_config and schema features for build intent", async () => {
    const f = mockFetch({
      entries: [
        {
          id: "r-1",
          catalog_id: "c-1",
          name: "orders",
          category: "table",
          status: "active",
          source_identifier: "orders",
          schema_definition: [
            { name: "title", type: "text" },
            { name: "body", type: "text", features: [] },
          ],
        },
      ],
    });
    await configureResourceIndex(ctx, "r-1", {
      buildKeyFields: ["id"],
      embeddingFields: ["title"],
      embeddingModel: "text-embedding-v4",
      fulltextFields: ["body"],
      fulltextAnalyzer: "ik_max_word",
    });
    const calls = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
    const body = JSON.parse(calls[1]?.[1].body as string);
    expect(body.index_config).toEqual({
      build_key_fields: ["id"],
      default_embedding_model: "text-embedding-v4",
      default_fulltext_analyzer: "ik_max_word",
    });
    expect(body.schema_definition[0].features[0]).toMatchObject({
      feature_type: "vector",
      ref_property: "title",
      config: { embedding_model: "text-embedding-v4" },
    });
    expect(body.schema_definition[1].features[0]).toMatchObject({
      feature_type: "fulltext",
      ref_property: "body",
      config: { analyzer: "ik_max_word" },
    });
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
    mockFetch({ entries: [{ name: "orders" }, { name: "orders_archive" }] });
    const exact = (await findResource(ctx, "orders", { exact: true })) as Array<{ name: string }>;
    expect(exact).toEqual([{ name: "orders" }]);
  });
  it("returns all fuzzy matches by default", async () => {
    mockFetch({ entries: [{ name: "orders" }, { name: "orders_archive" }] });
    const fuzzy = (await findResource(ctx, "orders")) as Array<{ name: string }>;
    expect(fuzzy).toHaveLength(2);
  });
});
