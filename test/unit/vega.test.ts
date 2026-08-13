import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type CatalogDeletionImpact,
  CreateBuildTaskRequest,
  catalogHealthStatus,
  createBuildTask,
  createCatalog,
  deleteBuildTasks,
  deleteCatalog,
  getBuildTask,
  getCatalog,
  getCatalogHealthCheckSchedule,
  listBuildTasks,
  listCatalogResources,
  listCatalogs,
  listConnectorTypes,
  runSql,
  startBuildTask,
  stopBuildTask,
  testCatalogConnection,
  testCatalogConnectionConfig,
  updateCatalog,
  updateCatalogHealthCheckSchedule,
} from "../../src/api/vega.js";
import { vega } from "../../src/resources/vega.js";
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

  it("catalogHealthStatus gets and parses one catalog", async () => {
    const f = mockFetch({
      id: "a b",
      health_check_status: "healthy",
      last_check_time: 123,
      health_check_result: "ok",
    });
    await expect(catalogHealthStatus(ctx, "a b")).resolves.toMatchObject({
      id: "a b",
      health_check_status: "healthy",
    });
    expect(new URL(firstCall(f)[0]).pathname).toBe(
      "/api/vega-backend/v1/catalogs/a%20b/health-status",
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
    const f = mockFetch({ id: "t-1" });
    const task = await createBuildTask(ctx, { resource_id: "r-1", mode: "batch" });
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/vega-backend/v1/build-tasks");
    expect(call[1].method).toBe("POST");
    expect(task).toEqual({ id: "t-1" });
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

  it("rejects execute_type for streaming tasks before making a request", () => {
    expect(
      CreateBuildTaskRequest.safeParse({
        resource_id: "r-1",
        mode: "streaming",
        execute_type: "full",
      }).success,
    ).toBe(false);
  });

  it("lists build tasks with server-side filters", async () => {
    const f = mockFetch({ entries: [], total_count: 0 });
    await listBuildTasks(ctx, {
      resourceId: "r-1",
      catalogId: "c-1",
      status: ["pending", "running"],
      mode: "batch",
      sort: "update_time",
      direction: "asc",
      limit: 5,
      offset: 10,
    });
    const u = new URL(firstCall(f)[0]);
    expect(u.pathname).toBe("/api/vega-backend/v1/build-tasks");
    expect(u.searchParams.get("resource_id")).toBe("r-1");
    expect(u.searchParams.get("catalog_id")).toBe("c-1");
    expect(u.searchParams.getAll("status")).toEqual(["pending", "running"]);
    expect(u.searchParams.has("active")).toBe(false);
    expect(u.searchParams.get("mode")).toBe("batch");
    expect(u.searchParams.get("sort")).toBe("update_time");
    expect(u.searchParams.get("direction")).toBe("asc");
    expect(u.searchParams.get("limit")).toBe("5");
    expect(u.searchParams.get("offset")).toBe("10");
  });

  it("parses list entries as typed summaries while preserving forward-compatible fields", async () => {
    mockFetch({
      entries: [
        {
          id: "t-1",
          resource_id: "r-1",
          catalog_id: "c-1",
          status: "completed",
          mode: "batch",
          total_count: 10,
          synced_count: 10,
          vectorized_count: 8,
          synced_mark: "mark-1",
          creator: { id: "u-1", type: "user" },
          create_time: 100,
          update_time: 200,
          failure_detail: "detail-only",
          index_config: { features: [{ vector: {} }] },
        },
      ],
      total_count: 1,
    });

    await expect(listBuildTasks(ctx)).resolves.toEqual({
      entries: [
        {
          id: "t-1",
          resource_id: "r-1",
          catalog_id: "c-1",
          status: "completed",
          mode: "batch",
          total_count: 10,
          synced_count: 10,
          vectorized_count: 8,
          synced_mark: "mark-1",
          creator: { id: "u-1", type: "user" },
          create_time: 100,
          update_time: 200,
          failure_detail: "detail-only",
          index_config: { features: [{ vector: {} }] },
        },
      ],
      total_count: 1,
    });
  });

  it("exposes the persisted batch execute_type on task responses", async () => {
    mockFetch({ id: "t-1", mode: "batch", execute_type: "incremental" });
    await expect(getBuildTask(ctx, "t-1")).resolves.toMatchObject({
      id: "t-1",
      execute_type: "incremental",
    });
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

describe("deleteCatalog", () => {
  it("returns a validated deletion impact for a dry run", async () => {
    const impact = {
      catalog_id: "c-1",
      can_delete: false,
      blockers: ["discover_tasks_running"],
      resources: 3,
      protected_resources: 0,
      build_tasks: { will_cancel: 1, blocking: 0 },
      catalog_health_check_schedules: 1,
      discover_schedules: 1,
      discover_tasks: { will_cancel: 2, blocking: 1 },
      semantic_understanding_tasks: { will_cancel: 0, blocking: 0 },
    };
    const f = mockFetch(impact);

    const apiResult = deleteCatalog(ctx, "c-1", { dryRun: true });
    expectTypeOf(apiResult).resolves.toEqualTypeOf<CatalogDeletionImpact>();
    await expect(apiResult).resolves.toEqual(impact);

    const resourceResult = vega(ctx).deleteCatalog("c-1", { dryRun: true });
    expectTypeOf(resourceResult).resolves.toEqualTypeOf<CatalogDeletionImpact>();
    await expect(resourceResult).resolves.toEqual(impact);
    const call = firstCall(f);
    const url = new URL(call[0]);
    expect(url.pathname).toBe("/api/vega-backend/v1/catalogs/c-1");
    expect(url.searchParams.get("dry_run")).toBe("true");
    expect(call[1].method).toBe("DELETE");
  });

  it("performs a real deletion without sending dry_run", async () => {
    const f = mockFetch();

    const apiResult = deleteCatalog(ctx, "c-1");
    expectTypeOf(apiResult).resolves.toBeUndefined();
    await expect(apiResult).resolves.toBeUndefined();

    const resourceResult = vega(ctx).deleteCatalog("c-1");
    expectTypeOf(resourceResult).resolves.toBeUndefined();
    await expect(resourceResult).resolves.toBeUndefined();
    const url = new URL(firstCall(f)[0]);
    expect(url.searchParams.has("dry_run")).toBe(false);
  });

  it("rejects an invalid deletion impact at the API boundary", async () => {
    mockFetch({ catalog_id: "c-1", can_delete: true });

    const result = deleteCatalog(ctx, "c-1", { dryRun: true });
    await expect(result).rejects.toThrow(/may not support deletion preflight/);
    await expect(result).rejects.toThrow(/discover_schedules/);
  });

  it("preserves unknown deletion blockers for forward compatibility", async () => {
    type ImpactBlocker = CatalogDeletionImpact["blockers"][number];
    expectTypeOf<ImpactBlocker>().not.toEqualTypeOf<string>();
    expectTypeOf<"future_blocker">().toMatchTypeOf<ImpactBlocker>();

    const impact = {
      catalog_id: "c-1",
      can_delete: false,
      blockers: ["future_blocker"],
      resources: 1,
      protected_resources: 0,
      build_tasks: { will_cancel: 0, blocking: 0 },
      catalog_health_check_schedules: 0,
      discover_schedules: 0,
      discover_tasks: { will_cancel: 0, blocking: 0 },
      semantic_understanding_tasks: { will_cancel: 0, blocking: 0 },
    };
    mockFetch(impact);

    await expect(deleteCatalog(ctx, "c-1", { dryRun: true })).resolves.toEqual(impact);
  });
});

describe("runSql", () => {
  it("POSTs an initial SQL query using the raw-query contract", async () => {
    const f = mockFetch({ rows: [] });
    await runSql(ctx, {
      query: "SELECT * FROM {{r-1}} LIMIT 5",
      query_format: "sql",
      input_dialect: "mysql",
      paging: { mode: "cursor", limit: 1000, keep_alive_sec: 300 },
      query_timeout_sec: 60,
      need_total: true,
    });
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/vega-backend/v1/resources/query");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body as string);
    expect(body.query).toBe("SELECT * FROM {{r-1}} LIMIT 5");
    expect(body).toEqual({
      query: "SELECT * FROM {{r-1}} LIMIT 5",
      query_format: "sql",
      input_dialect: "mysql",
      paging: { mode: "cursor", limit: 1000, keep_alive_sec: 300 },
      query_timeout_sec: 60,
      need_total: true,
    });
  });

  it("POSTs only the opaque cursor for a continuation", async () => {
    const f = mockFetch({ rows: [] });
    await runSql(ctx, { paging: { cursor: "cursor-1" }, need_total: true });
    const body = JSON.parse(firstCall(f)[1].body as string);
    expect(body).toEqual({ paging: { cursor: "cursor-1" }, need_total: true });
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

  it("sends allow_unhealthy and an initial health-check schedule", async () => {
    const f = mockFetch({ id: "c-9" });
    await createCatalog(
      ctx,
      {
        name: "my-cat",
        connectorType: "mysql",
        connectorConfig: { host: "h" },
        healthCheckSchedule: { mode: "enabled", cronExpr: "0 */2 * * *" },
      },
      { allowUnhealthy: true },
    );
    const call = firstCall(f);
    const url = new URL(call[0]);
    expect(url.searchParams.get("allow_unhealthy")).toBe("true");
    expect(JSON.parse(call[1].body as string).health_check_schedule).toEqual({
      mode: "enabled",
      cron_expr: "0 */2 * * *",
    });
  });
});

describe("updateCatalog", () => {
  it("sends a full PUT body with the path id and allow_unhealthy", async () => {
    const f = mockFetch();
    await updateCatalog(
      ctx,
      "c-9",
      {
        name: "renamed",
        connectorType: "mysql",
        connectorConfig: { host: "new-host" },
        enabled: false,
        tags: [],
        description: "",
        extensions: {},
      },
      { allowUnhealthy: true },
    );
    const call = firstCall(f);
    const url = new URL(call[0]);
    expect(url.pathname).toBe("/api/vega-backend/v1/catalogs/c-9");
    expect(url.searchParams.get("allow_unhealthy")).toBe("true");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body as string)).toEqual({
      id: "c-9",
      name: "renamed",
      connector_type: "mysql",
      connector_config: { host: "new-host" },
      enabled: false,
      tags: [],
      description: "",
      extensions: {},
    });
  });
});

describe("catalog connection tests", () => {
  it("preflights an unpersisted connector configuration", async () => {
    const f = mockFetch({ success: true, message: "connected" });
    await expect(
      testCatalogConnectionConfig(ctx, {
        connectorType: "postgresql",
        connectorConfig: { host: "db.example.com" },
      }),
    ).resolves.toEqual({ success: true, message: "connected" });
    const call = firstCall(f);
    expect(new URL(call[0]).pathname).toBe("/api/vega-backend/v1/catalogs/test-connection");
    expect(JSON.parse(call[1].body as string)).toEqual({
      connector_type: "postgresql",
      connector_config: { host: "db.example.com" },
    });
  });

  it("returns a persisted catalog's business failure result", async () => {
    const f = mockFetch({ success: false, message: "connection refused" });
    await expect(testCatalogConnection(ctx, "c 9")).resolves.toEqual({
      success: false,
      message: "connection refused",
    });
    expect(new URL(firstCall(f)[0]).pathname).toBe(
      "/api/vega-backend/v1/catalogs/c%209/test-connection",
    );
  });

  it("rejects a malformed connection-test response", async () => {
    mockFetch({ message: "missing success" });
    await expect(testCatalogConnection(ctx, "c-9")).rejects.toThrow();
  });
});

describe("catalog health-check schedule", () => {
  const response = {
    catalog_id: "c-9",
    mode: "enabled",
    cron_expr: "0 */2 * * *",
    last_run: 100,
    next_run: 200,
  };

  it("gets and parses the dedicated schedule", async () => {
    const f = mockFetch(response);
    await expect(getCatalogHealthCheckSchedule(ctx, "c-9")).resolves.toEqual(response);
    expect(new URL(firstCall(f)[0]).pathname).toBe(
      "/api/vega-backend/v1/catalogs/c-9/health-check-schedule",
    );
  });

  it("updates the schedule without sending cron outside enabled mode", async () => {
    const f = mockFetch({ ...response, mode: "disabled", next_run: 0 });
    await updateCatalogHealthCheckSchedule(ctx, "c-9", { mode: "disabled" });
    const call = firstCall(f);
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body as string)).toEqual({ mode: "disabled" });
  });
});
