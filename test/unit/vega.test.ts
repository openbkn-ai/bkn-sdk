import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogHealthStatus,
  createBuildTask,
  createCatalog,
  getCatalog,
  listCatalogResources,
  listConnectorTypes,
} from "../../src/api/vega.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

type CallArgs = [string, RequestInit];
function mockFetch(body: unknown = {}): typeof fetch {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function firstCall(f: typeof fetch): CallArgs {
  const a = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!a) throw new Error("fetch not called");
  return a;
}
afterEach(() => vi.unstubAllGlobals());

describe("vega uses the vega-backend base path", () => {
  it("getCatalog", async () => {
    const f = mockFetch();
    await getCatalog(ctx, "c-1");
    expect(new URL(firstCall(f)[0]).pathname).toBe("/api/vega-backend/v1/catalogs/c-1");
  });

  it("catalogResources with category", async () => {
    const f = mockFetch();
    await listCatalogResources(ctx, "c-1", "table");
    const u = new URL(firstCall(f)[0]);
    expect(u.pathname).toBe("/api/vega-backend/v1/catalogs/c-1/resources");
    expect(u.searchParams.get("category")).toBe("table");
  });

  it("catalogHealthStatus joins ids", async () => {
    const f = mockFetch();
    await catalogHealthStatus(ctx, ["a", "b"]);
    expect(new URL(firstCall(f)[0]).pathname).toBe(
      "/api/vega-backend/v1/catalogs/a,b/health-status",
    );
  });

  it("listConnectorTypes sorts by name", async () => {
    const f = mockFetch();
    await listConnectorTypes(ctx);
    const u = new URL(firstCall(f)[0]);
    expect(u.pathname).toBe("/api/vega-backend/v1/connector-types");
    expect(u.searchParams.get("sort")).toBe("name");
  });
});

describe("createBuildTask", () => {
  it("POSTs to /build-tasks under vega-backend", async () => {
    const f = mockFetch({ id: "t-1", resource_id: "r-1", mode: "batch" });
    await createBuildTask(ctx, { resource_id: "r-1", mode: "batch" });
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/vega-backend/v1/build-tasks");
    expect(call[1].method).toBe("POST");
  });

  it("serializes embedding/build-key field arrays into comma-joined strings", async () => {
    // The backend types these as `string`, not `[]string` — see build_task.go.
    const f = mockFetch({ id: "t-1", resource_id: "r-1", mode: "batch" });
    await createBuildTask(ctx, {
      resource_id: "r-1",
      mode: "batch",
      embedding_fields: ["name", "description"],
      build_key_fields: ["skill_id"],
    });
    const body = JSON.parse(firstCall(f)[1].body as string);
    expect(body.embedding_fields).toBe("name,description");
    expect(body.build_key_fields).toBe("skill_id");
  });
});

describe("createCatalog", () => {
  it("POSTs connector fields to /catalogs", async () => {
    const f = mockFetch({ id: "c-9" });
    await createCatalog(ctx, {
      name: "my-cat",
      connectorType: "mysql",
      connectorConfig: { host: "h" },
    });
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/vega-backend/v1/catalogs");
    const body = JSON.parse(call[1].body as string);
    expect(body.connector_type).toBe("mysql");
    expect(body.connector_config).toEqual({ host: "h" });
  });
});
