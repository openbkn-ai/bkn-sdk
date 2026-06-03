import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteResource,
  findResource,
  listResources,
  queryResource,
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
  it("maps datasourceId→catalog_id and type→category", async () => {
    const f = mockFetch();
    await listResources(ctx, { datasourceId: "ds-1", category: "table", limit: 10 });
    const url = new URL(firstCall(f)[0]);
    expect(url.pathname).toBe("/api/vega-backend/v1/resources");
    expect(url.searchParams.get("catalog_id")).toBe("ds-1");
    expect(url.searchParams.get("category")).toBe("table");
    expect(url.searchParams.get("limit")).toBe("10");
  });
});

describe("queryResource", () => {
  it("POSTs to /data with paging body", async () => {
    const f = mockFetch();
    await queryResource(ctx, "r-1", { limit: 5, offset: 2, needTotal: true });
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/vega-backend/v1/resources/r-1/data");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body as string)).toEqual({ limit: 5, offset: 2, need_total: true });
  });
});

describe("deleteResource", () => {
  it("DELETEs by id", async () => {
    const f = mockFetch({});
    await deleteResource(ctx, "r 9");
    const call = firstCall(f);
    expect(call[1].method).toBe("DELETE");
    expect(new URL(call[0]).pathname).toBe("/api/vega-backend/v1/resources/r%209");
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
