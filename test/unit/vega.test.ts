import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogHealthStatus,
  createBuildTask,
  createCatalog,
  deleteBuildTasks,
  getCatalog,
  listBuildTasks,
  listCatalogResources,
  listCatalogs,
  listConnectorTypes,
  runSql,
  startBuildTask,
  stopBuildTask,
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

  it("catalogResources lists via /resources?catalog_id (no /catalogs/:id/resources route)", async () => {
    const f = mockFetch();
    await listCatalogResources(ctx, "c-1", "table");
    const u = new URL(firstCall(f)[0]);
    expect(u.pathname).toBe("/api/vega-backend/v1/resources");
    expect(u.searchParams.get("catalog_id")).toBe("c-1");
    expect(u.searchParams.get("category")).toBe("table");
    // No explicit limit → backend applies its own default (DEFAULT_LIMIT=20).
    expect(u.searchParams.has("limit")).toBe(false);
  });

  it("catalogResources forwards limit/offset (limit=-1 fetches all)", async () => {
    const f = mockFetch();
    await listCatalogResources(ctx, "c-1", undefined, -1, 40);
    const u = new URL(firstCall(f)[0]);
    expect(u.searchParams.get("limit")).toBe("-1");
    expect(u.searchParams.get("offset")).toBe("40");
  });

  it("catalogResources drops a NaN limit (never sends limit=NaN)", async () => {
    const f = mockFetch();
    await listCatalogResources(ctx, "c-1", undefined, Number.NaN);
    expect(new URL(firstCall(f)[0]).searchParams.has("limit")).toBe(false);
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

  it("listCatalogs sends new filters and repeated extension params", async () => {
    const f = mockFetch();
    await listCatalogs(ctx, {
      name: "prod",
      tag: "crm",
      type: "physical",
      enabled: true,
      healthCheckStatus: "healthy",
      includeExtensions: true,
      includeExtensionKeys: "owner,env",
      extensionPairs: [
        { key: "owner", value: "data" },
        { key: "env", value: "prod" },
      ],
      sort: "name",
      direction: "asc",
    });
    const u = new URL(firstCall(f)[0]);
    expect(u.searchParams.get("name")).toBe("prod");
    expect(u.searchParams.get("tag")).toBe("crm");
    expect(u.searchParams.get("type")).toBe("physical");
    expect(u.searchParams.get("enabled")).toBe("true");
    expect(u.searchParams.get("health_check_status")).toBe("healthy");
    expect(u.searchParams.get("include_extensions")).toBe("true");
    expect(u.searchParams.get("include_extension_keys")).toBe("owner,env");
    expect(u.searchParams.getAll("extension_key")).toEqual(["owner", "env"]);
    expect(u.searchParams.getAll("extension_value")).toEqual(["data", "prod"]);
    expect(u.searchParams.get("sort")).toBe("name");
    expect(u.searchParams.get("direction")).toBe("asc");
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

  it("sends execute_type but no resource index fields in the task body", async () => {
    const f = mockFetch({ id: "t-1", resource_id: "r-1", mode: "batch" });
    await createBuildTask(ctx, {
      resource_id: "r-1",
      mode: "batch",
      execute_type: "full",
    });
    const body = JSON.parse(firstCall(f)[1].body as string);
    expect(body).toEqual({ resource_id: "r-1", mode: "batch", execute_type: "full" });
  });

  it("lists build tasks with server-side filters", async () => {
    const f = mockFetch({ entries: [] });
    await listBuildTasks(ctx, {
      resourceId: "r-1",
      catalogId: "c-1",
      status: ["running", "init"],
      active: true,
      mode: "batch",
      orderBy: "status",
      order: "asc",
      limit: 5,
      offset: 10,
    });
    const u = new URL(firstCall(f)[0]);
    expect(u.pathname).toBe("/api/vega-backend/v1/build-tasks");
    expect(u.searchParams.get("resource_id")).toBe("r-1");
    expect(u.searchParams.get("catalog_id")).toBe("c-1");
    expect(u.searchParams.get("status")).toBe("running,init");
    expect(u.searchParams.get("active")).toBe("true");
    expect(u.searchParams.get("mode")).toBe("batch");
    expect(u.searchParams.get("order_by")).toBe("status");
    expect(u.searchParams.get("order")).toBe("asc");
    expect(u.searchParams.get("limit")).toBe("5");
    expect(u.searchParams.get("offset")).toBe("10");
  });

  it("starts, stops, and deletes build tasks", async () => {
    const f = mockFetch({});
    await startBuildTask(ctx, "t-1", { reset: true });
    await stopBuildTask(ctx, "t-1");
    await deleteBuildTasks(ctx, ["t-1", "t-2"], {
      ignoreMissing: true,
      deleteActiveIndex: true,
    });
    const calls = (f as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
    expect(new URL(calls[0]?.[0] ?? "").pathname).toBe(
      "/api/vega-backend/v1/build-tasks/t-1/start",
    );
    expect(JSON.parse(calls[0]?.[1].body as string)).toEqual({ reset: true });
    expect(new URL(calls[1]?.[0] ?? "").pathname).toBe("/api/vega-backend/v1/build-tasks/t-1/stop");
    const deleteUrl = new URL(calls[2]?.[0] ?? "");
    expect(deleteUrl.pathname).toBe("/api/vega-backend/v1/build-tasks/t-1,t-2");
    expect(deleteUrl.searchParams.get("ignore_missing")).toBe("true");
    expect(deleteUrl.searchParams.get("delete_active_index")).toBe("true");
  });
});

describe("runSql", () => {
  it("POSTs query + resource_type to /resources/query", async () => {
    const f = mockFetch({ rows: [] });
    await runSql(ctx, {
      query: "SELECT * FROM {{r-1}} LIMIT 5",
      resource_type: "mysql",
      stream_size: 1000,
    });
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/vega-backend/v1/resources/query");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body as string);
    expect(body.query).toBe("SELECT * FROM {{r-1}} LIMIT 5");
    expect(body.resource_type).toBe("mysql");
    expect(body.stream_size).toBe(1000);
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
