// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Vega backend client — catalog/resource reads + BuildTask (index build).
 * Build config is snapshotted from the Resource's schema_definition/features and
 * index_config when the BuildTask is created.
 */
import { z } from "zod";
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

// Vega backend base path.
const VEGA_BASE = "/api/vega-backend/v1";

export const BuildMode = z.enum(["batch", "streaming"]);
export type BuildMode = z.infer<typeof BuildMode>;

/** POST /build-tasks body. */
export const CreateBuildTaskRequest = z.object({
  resource_id: z.string().min(1),
  mode: BuildMode,
  execute_type: z.enum(["incremental", "full"]).optional(),
});
export type CreateBuildTaskRequest = z.infer<typeof CreateBuildTaskRequest>;

// Lenient: create vs list vs status responses carry different subsets — `status`
// is the live field (not `state`); the create response can omit `mode`.
export const BuildTask = z
  .object({
    id: z.string(),
    resource_id: z.string().optional(),
    mode: BuildMode.optional(),
    status: z.string().optional(),
    state: z.string().optional(),
    total_count: z.number().optional(),
    synced_count: z.number().optional(),
    vectorized_count: z.number().optional(),
    index_config: z.unknown().optional(),
    catalog_id: z.string().optional(),
    index_health: z
      .object({
        embedding: z.string(),
        fulltext: z.string(),
        usable: z.boolean(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type BuildTask = z.infer<typeof BuildTask>;

/** Create an index BuildTask for a resource. Returns the task (with its id). */
export async function createBuildTask(
  ctx: RequestContext,
  req: CreateBuildTaskRequest,
): Promise<BuildTask> {
  const p = CreateBuildTaskRequest.parse(req);
  const body = {
    resource_id: p.resource_id,
    mode: p.mode,
    ...(p.execute_type ? { execute_type: p.execute_type } : {}),
  };
  const res = await request<unknown>(ctx, `${VEGA_BASE}/build-tasks`, { method: "POST", body });
  return BuildTask.parse(res);
}

export interface ListBuildTasksOptions {
  limit?: number;
  offset?: number;
  resourceId?: string;
  catalogId?: string;
  status?: string | string[];
  active?: boolean;
  mode?: BuildMode;
  orderBy?: "default" | "created_at" | "updated_at" | "status" | "mode";
  order?: "asc" | "desc";
}

export function listBuildTasks(
  ctx: RequestContext,
  opts: ListBuildTasksOptions = {},
): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/build-tasks`, {
    query: {
      limit: opts.limit,
      offset: opts.offset,
      resource_id: opts.resourceId || undefined,
      catalog_id: opts.catalogId || undefined,
      status: Array.isArray(opts.status) ? opts.status.join(",") : opts.status || undefined,
      active: opts.active === undefined ? undefined : String(opts.active),
      mode: opts.mode,
      order_by: opts.orderBy,
      order: opts.order,
    },
  });
}

/** Fetch a BuildTask's progress/state. */
export async function getBuildTask(ctx: RequestContext, taskId: string): Promise<BuildTask> {
  const res = await request<unknown>(ctx, `${VEGA_BASE}/build-tasks/${encodeURIComponent(taskId)}`);
  return BuildTask.parse(res);
}

export interface DeleteBuildTasksOptions {
  ignoreMissing?: boolean;
  deleteActiveIndex?: boolean;
}

export function deleteBuildTasks(
  ctx: RequestContext,
  ids: string[],
  opts: DeleteBuildTasksOptions = {},
): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/build-tasks/${ids.map(encodeURIComponent).join(",")}`, {
    method: "DELETE",
    query: {
      ignore_missing: opts.ignoreMissing === undefined ? undefined : String(opts.ignoreMissing),
      delete_active_index:
        opts.deleteActiveIndex === undefined ? undefined : String(opts.deleteActiveIndex),
    },
  });
}

export function startBuildTask(
  ctx: RequestContext,
  taskId: string,
  opts: { reset?: boolean } = {},
): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/build-tasks/${encodeURIComponent(taskId)}/start`, {
    method: "POST",
    body: opts.reset === undefined ? {} : { reset: opts.reset },
  });
}

export function stopBuildTask(ctx: RequestContext, taskId: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/build-tasks/${encodeURIComponent(taskId)}/stop`, {
    method: "POST",
  });
}

export interface SqlQueryRequest {
  /** SQL string (MySQL/MariaDB/PostgreSQL) or an OpenSearch DSL object. */
  query: string | Record<string, unknown>;
  /** Query mode. `stream` uses cursor-style paging through `query_id`. */
  query_type?: "standard" | "stream";
  /**
   * Source type (mysql | mariadb | postgresql | opensearch …). Required by the
   * current vega-backend raw query handler.
   */
  resource_type: string;
  /** Streaming batch size (100–10000, default server-side). */
  stream_size?: number;
  /** Query timeout in seconds (1–3600). */
  query_timeout?: number;
  /** Cursor session id for paged streaming. */
  query_id?: string;
}

/**
 * Run SQL (or an OpenSearch DSL) directly against a data source. vega-backend
 * connects through the resource's Catalog connector — reference the resource in
 * the SQL with a `{{<resource-id>}}` placeholder so the backend knows which
 * connector to use. `POST /api/vega-backend/v1/resources/query`.
 */
export function runSql(ctx: RequestContext, body: SqlQueryRequest): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/resources/query`, { method: "POST", body });
}

export interface ListCatalogsOptions {
  limit?: number;
  offset?: number;
  name?: string;
  tag?: string;
  type?: "physical" | "logical" | string;
  enabled?: boolean;
  healthCheckStatus?: string;
  includeExtensions?: boolean;
  includeExtensionKeys?: string;
  extensionPairs?: Array<{ key: string; value: string }>;
  sort?: "name" | "create_time" | "update_time" | string;
  direction?: "asc" | "desc";
}

/** List catalog entries (raw passthrough — shape varies by backend). */
export async function listCatalogs(
  ctx: RequestContext,
  opts: ListCatalogsOptions = {},
): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs`, {
    query: {
      limit: opts.limit,
      offset: opts.offset,
      name: opts.name || undefined,
      tag: opts.tag || undefined,
      type: opts.type || undefined,
      enabled: opts.enabled === undefined ? undefined : String(opts.enabled),
      health_check_status: opts.healthCheckStatus || undefined,
      include_extensions:
        opts.includeExtensions === undefined ? undefined : String(opts.includeExtensions),
      include_extension_keys: opts.includeExtensionKeys || undefined,
      extension_key: opts.extensionPairs?.map((p) => p.key),
      extension_value: opts.extensionPairs?.map((p) => p.value),
      sort: opts.sort,
      direction: opts.direction,
    },
  });
}

export function getCatalog(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}`);
}

/** POST /catalogs body. `connector_config` shape varies by connector (raw passthrough). */
export interface CreateCatalogRequest {
  name: string;
  connectorType: string;
  connectorConfig: unknown;
  tags?: string[];
  description?: string;
  enabled?: boolean;
  id?: string;
  internal?: boolean;
  extensions?: Record<string, string>;
}

/** Create a Vega catalog (data source). Returns the created catalog (with its id). */
export function createCatalog(ctx: RequestContext, req: CreateCatalogRequest): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs`, {
    method: "POST",
    body: {
      ...(req.id ? { id: req.id } : {}),
      name: req.name,
      connector_type: req.connectorType,
      connector_config: req.connectorConfig,
      ...(req.tags ? { tags: req.tags } : {}),
      ...(req.description ? { description: req.description } : {}),
      ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
      ...(req.internal !== undefined ? { internal: req.internal } : {}),
      ...(req.extensions ? { extensions: req.extensions } : {}),
    },
  });
}

export function updateCatalog(
  ctx: RequestContext,
  id: string,
  req: Partial<CreateCatalogRequest>,
): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: {
      ...(req.id ? { id: req.id } : {}),
      ...(req.name ? { name: req.name } : {}),
      ...(req.connectorType ? { connector_type: req.connectorType } : {}),
      ...(req.connectorConfig !== undefined ? { connector_config: req.connectorConfig } : {}),
      ...(req.tags ? { tags: req.tags } : {}),
      ...(req.description !== undefined ? { description: req.description } : {}),
      ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
      ...(req.extensions ? { extensions: req.extensions } : {}),
    },
  });
}

/** Enable a catalog (catalogs are created disabled; discovery needs it enabled). */
export function enableCatalog(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/enable`, { method: "POST" });
}

export function disableCatalog(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/disable`, {
    method: "POST",
  });
}

export function deleteCatalog(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function testCatalogConnection(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/test-connection`, {
    method: "POST",
  });
}

/** Trigger a catalog metadata scan (discover). `wait=true` blocks until done. */
export function discoverCatalog(ctx: RequestContext, id: string, wait = true): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/discover`, {
    method: "POST",
    query: { wait },
    timeoutMs: 120_000,
  });
}

/** Resources under a catalog (optionally filtered by category). */
export function listCatalogResources(
  ctx: RequestContext,
  id: string,
  category?: string,
  limit?: number,
  offset?: number,
): Promise<unknown> {
  // The backend has no `/catalogs/:id/resources` route — resources are listed
  // via `/resources?catalog_id=…` (same endpoint as `resource list`). Without an
  // explicit `limit` the backend defaults to DEFAULT_LIMIT=20 (range [1,1000]);
  // pass limit=-1 (NO_LIMIT) to fetch every resource.
  return request(ctx, `${VEGA_BASE}/resources`, {
    query: {
      catalog_id: id,
      category: category || undefined,
      // limit=-1 (NO_LIMIT) fetches all; NaN / 0 fall back to the backend default.
      limit: Number.isFinite(limit) && (limit! > 0 || limit === -1) ? limit : undefined,
      offset: offset || undefined,
    },
  });
}

/** Health-status for one or more catalog ids (comma-joined in the path). */
export function catalogHealthStatus(ctx: RequestContext, ids: string[]): Promise<unknown> {
  return request(
    ctx,
    `${VEGA_BASE}/catalogs/${ids.map(encodeURIComponent).join(",")}/health-status`,
  );
}

export function listConnectorTypes(ctx: RequestContext): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/connector-types`, { query: { sort: "name", order: "asc" } });
}

export function getConnectorType(ctx: RequestContext, type: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/connector-types/${encodeURIComponent(type)}`);
}
