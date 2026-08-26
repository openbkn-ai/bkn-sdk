// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Vega backend client — catalog/resource reads + BuildTask (index build).
 * Build config is snapshotted from the Resource's schema_definition/features and
 * index_config when the BuildTask is created.
 */
import { z } from "zod";
import { DEFAULT_LIST_LIMIT, type RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { request } from "./http.js";
import {
  ListResourcesResponse,
  type ListResourcesResponse as ListResourcesResult,
} from "./resources.js";

// Vega backend base path.
const VEGA_BASE = "/api/vega-backend/v1";

export const BuildMode = z.enum(["batch", "streaming"]);
export type BuildMode = z.infer<typeof BuildMode>;

export const BuildTaskExecuteType = z.enum(["incremental", "full"]);
export type BuildTaskExecuteType = z.infer<typeof BuildTaskExecuteType>;

export const BuildTaskStatus = z.enum([
  "pending",
  "running",
  "stopping",
  "stopped",
  "completed",
  "failed",
  "cancelled",
]);
export type BuildTaskStatus = z.infer<typeof BuildTaskStatus>;

export const BuildTaskSort = z.enum([
  "create_time",
  "start_time",
  "finish_time",
  "last_progress_time",
]);
export type BuildTaskSort = z.infer<typeof BuildTaskSort>;

export const SortDirection = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirection>;

export const CatalogHealthCheckScheduleMode = z.enum(["inherit", "enabled", "disabled"]);
export type CatalogHealthCheckScheduleMode = z.infer<typeof CatalogHealthCheckScheduleMode>;

export const CatalogHealthCheckStatus = z.enum([
  "healthy",
  "degraded",
  "unhealthy",
  "offline",
  "unchecked",
]);
export type CatalogHealthCheckStatus = z.infer<typeof CatalogHealthCheckStatus>;

export const Catalog = z
  .object({
    id: z.string(),
    name: z.string(),
    tags: z.array(z.string()).optional(),
    description: z.string().optional(),
    type: z.string(),
    enabled: z.boolean(),
    internal: z.boolean().optional(),
    connector_type: z.string(),
    connector_config: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    health_check_status: z.string().optional(),
    last_check_time: z.number().optional(),
    health_check_result: z.string().optional(),
    creator: z
      .object({
        id: z.string().optional(),
        type: z.string().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    create_time: z.number().optional(),
    updater: z
      .object({
        id: z.string().optional(),
        type: z.string().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    update_time: z.number(),
    operations: z.array(z.string()).optional(),
  })
  .passthrough();
export type Catalog = z.infer<typeof Catalog>;

export const ListCatalogsResponse = z
  .object({ entries: z.array(Catalog), total_count: z.number() })
  .passthrough();
export type ListCatalogsResponse = z.infer<typeof ListCatalogsResponse>;

export const BatchCatalogsResponse = z.object({ entries: z.array(Catalog) }).passthrough();
export type BatchCatalogsResponse = z.infer<typeof BatchCatalogsResponse>;

export const CatalogRef = z.object({ id: z.string() }).passthrough();
export type CatalogRef = z.infer<typeof CatalogRef>;

export const CatalogHealthStatus = z
  .object({
    id: z.string(),
    health_check_status: z.string(),
    last_check_time: z.number().optional(),
    health_check_result: z.string().optional(),
  })
  .passthrough();
export type CatalogHealthStatus = z.infer<typeof CatalogHealthStatus>;

export type CatalogHealthCheckScheduleConfig =
  | { mode: "enabled"; cronExpr: string }
  | { mode: "inherit" | "disabled"; cronExpr?: never };

export type CatalogHealthCheckScheduleRequest = CatalogHealthCheckScheduleConfig & {
  /** Required optimistic-lock version from the latest schedule `update_time`. */
  expectedUpdateTime: number;
};

export const CatalogHealthCheckSchedule = z
  .object({
    catalog_id: z.string(),
    mode: z.string(),
    cron_expr: z.string().optional(),
    last_run: z.number(),
    next_run: z.number(),
    update_time: z.number(),
  })
  .passthrough();
export type CatalogHealthCheckSchedule = z.infer<typeof CatalogHealthCheckSchedule>;

export interface CatalogConnectionTestRequest {
  connectorType: string;
  connectorConfig: Record<string, unknown>;
}

export const CatalogConnectionTestResult = z
  .object({
    success: z.boolean(),
    message: z.string().optional(),
  })
  .passthrough();
export type CatalogConnectionTestResult = z.infer<typeof CatalogConnectionTestResult>;

export interface CatalogWriteOptions {
  allowUnhealthy?: boolean;
}

export const CatalogDeletionBlocker = z.enum([
  "protected_resources",
  "build_tasks_running_or_stopping",
  "discover_tasks_running",
  "semantic_understanding_tasks_running",
]);
export type CatalogDeletionBlocker = z.infer<typeof CatalogDeletionBlocker>;
const UnknownCatalogDeletionBlocker = z.string() as z.ZodType<string & {}>;

export const CatalogDeletionTaskImpact = z.object({
  will_cancel: z.number().int(),
  blocking: z.number().int(),
});
export type CatalogDeletionTaskImpact = z.infer<typeof CatalogDeletionTaskImpact>;

export const CatalogDeletionImpact = z
  .object({
    catalog_id: z.string(),
    can_delete: z.boolean(),
    blockers: z.array(CatalogDeletionBlocker.or(UnknownCatalogDeletionBlocker)),
    resources: z.number().int(),
    protected_resources: z.number().int(),
    build_tasks: CatalogDeletionTaskImpact,
    catalog_health_check_schedules: z.number().int(),
    discover_schedules: z.number().int(),
    discover_tasks: CatalogDeletionTaskImpact,
    semantic_understanding_tasks: CatalogDeletionTaskImpact,
  })
  .passthrough();
export type CatalogDeletionImpact = z.infer<typeof CatalogDeletionImpact>;

export interface DeleteCatalogOptions {
  dryRun?: boolean;
}

export type DeleteCatalogResult<T extends DeleteCatalogOptions | undefined> = T extends undefined
  ? undefined
  : T extends { dryRun: true }
    ? CatalogDeletionImpact
    : T extends { dryRun?: false | undefined }
      ? undefined
      : CatalogDeletionImpact | undefined;

/** POST /build-tasks body. */
export const CreateBuildTaskRequest = z.discriminatedUnion("mode", [
  z.object({
    resource_id: z.string().min(1),
    mode: z.literal("batch"),
    execute_type: BuildTaskExecuteType.optional(),
  }),
  z.object({
    resource_id: z.string().min(1),
    mode: z.literal("streaming"),
    // Streaming tasks do not have an execution type.
    execute_type: z.never().optional(),
  }),
]);
export type CreateBuildTaskRequest = z.infer<typeof CreateBuildTaskRequest>;

// Lenient: create vs list vs status responses carry different subsets — `status`
// is the live field (not `state`); the create response can omit `mode`.
export const BuildTask = z
  .object({
    id: z.string(),
    resource_id: z.string().optional(),
    mode: BuildMode.optional(),
    status: BuildTaskStatus.optional(),
    state: z.string().optional(),
    total_count: z.number().optional(),
    synced_count: z.number().optional(),
    start_time: z.number().optional(),
    finish_time: z.number().optional(),
    last_progress_time: z.number().optional(),
    index_config: z.unknown().optional(),
    catalog_id: z.string().optional(),
    execute_type: BuildTaskExecuteType.optional(),
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

/** Lightweight BuildTask representation returned by list APIs. */
export const BuildTaskSummary = z
  .object({
    id: z.string(),
    resource_id: z.string(),
    resource_name: z.string().optional(),
    catalog_id: z.string(),
    catalog_name: z.string().optional(),
    status: BuildTaskStatus,
    mode: BuildMode,
    execute_type: BuildTaskExecuteType.optional(),
    total_count: z.number(),
    synced_count: z.number(),
    synced_mark: z.string(),
    error_msg: z.string().optional(),
    creator: z.object({
      id: z.string(),
      name: z.string().optional(),
      type: z.string(),
    }),
    create_time: z.number(),
    start_time: z.number().optional(),
    finish_time: z.number().optional(),
    last_progress_time: z.number().optional(),
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
export type BuildTaskSummary = z.infer<typeof BuildTaskSummary>;

export const ListBuildTasksResponse = z
  .object({
    entries: z.array(BuildTaskSummary),
    total_count: z.number(),
  })
  .passthrough();
export type ListBuildTasksResponse = z.infer<typeof ListBuildTasksResponse>;

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
  status?: BuildTaskStatus | BuildTaskStatus[];
  mode?: BuildMode;
  sort?: BuildTaskSort;
  direction?: SortDirection;
}

export async function listBuildTasks(
  ctx: RequestContext,
  opts: ListBuildTasksOptions = {},
): Promise<ListBuildTasksResponse> {
  const legacy = opts as ListBuildTasksOptions & { orderBy?: unknown; order?: unknown };
  if (legacy.orderBy !== undefined || legacy.order !== undefined) {
    throw new InputError(
      'orderBy/order were replaced by sort ("create_time" | "start_time" | "finish_time" | "last_progress_time") and direction ("asc" | "desc")',
    );
  }
  if (opts.sort !== undefined && !BuildTaskSort.safeParse(opts.sort).success) {
    throw new InputError(
      `invalid build task sort "${opts.sort}"; expected one of ${BuildTaskSort.options.join(", ")}`,
    );
  }
  const res = await request<unknown>(ctx, `${VEGA_BASE}/build-tasks`, {
    query: {
      limit: opts.limit ?? DEFAULT_LIST_LIMIT,
      offset: opts.offset,
      resource_id: opts.resourceId || undefined,
      catalog_id: opts.catalogId || undefined,
      status: opts.status || undefined,
      mode: opts.mode,
      sort: opts.sort,
      direction: opts.direction,
    },
  });
  return ListBuildTasksResponse.parse(res);
}

/** Fetch a BuildTask's progress/state. */
export async function getBuildTask(ctx: RequestContext, taskId: string): Promise<BuildTask> {
  const res = await request<unknown>(ctx, `${VEGA_BASE}/build-tasks/${encodeURIComponent(taskId)}`);
  return BuildTask.parse(res);
}

export interface DeleteBuildTasksOptions {
  ignoreMissing?: boolean;
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

export type QueryPagingMode = "single" | "cursor";

/** Paging options for an initial Vega raw query. */
export interface RawQueryPaging {
  mode?: QueryPagingMode;
  offset?: number;
  limit?: number;
  keep_alive_sec?: number;
}

/** Opaque cursor continuation. No initial-query fields may accompany it. */
export interface RawQueryContinuationRequest {
  paging: { cursor: string };
  /** Accepted by the API but cannot override the value frozen on the first page. */
  need_total?: boolean;
}

interface RawQueryInitialBase {
  paging?: RawQueryPaging;
  /** Per-page timeout in seconds (1–3600); defaults to 60 server-side. */
  query_timeout_sec?: number;
  need_total?: boolean;
}

export interface SqlRawQueryRequest extends RawQueryInitialBase {
  query: string;
  query_format: "sql";
  /** SQL input dialect; defaults to postgres server-side. */
  input_dialect?: "postgres" | "mysql" | "trino" | "duckdb";
}

export interface DslRawQueryRequest extends RawQueryInitialBase {
  query: Record<string, unknown>;
  query_format: "dsl";
  input_dialect: "opensearch";
}

/** Request contract for POST /resources/query. */
export type RawQueryRequest = SqlRawQueryRequest | DslRawQueryRequest | RawQueryContinuationRequest;

/** @deprecated Use RawQueryRequest. */
export type SqlQueryRequest = RawQueryRequest;

/**
 * Run SQL (or an OpenSearch DSL) directly against a data source. vega-backend
 * connects through the resource's Catalog connector — reference the resource in
 * the SQL with a `{{<resource-id>}}` placeholder so the backend knows which
 * connector to use. `POST /api/vega-backend/v1/resources/query`.
 */
export function runSql(ctx: RequestContext, body: RawQueryRequest): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/resources/query`, {
    method: "POST",
    body,
    responseParser: parseBigIntJSON,
  });
}

export interface ListCatalogsOptions {
  limit?: number;
  offset?: number;
  name?: string;
  tag?: string;
  type?: "physical" | "logical";
  connectorType?: string;
  enabled?: boolean;
  healthCheckStatus?: CatalogHealthCheckStatus;
  sort?: "name" | "create_time" | "update_time";
  direction?: "asc" | "desc";
}

export async function listCatalogs(
  ctx: RequestContext,
  opts: ListCatalogsOptions = {},
): Promise<ListCatalogsResponse> {
  const result = await request<unknown>(ctx, `${VEGA_BASE}/catalogs`, {
    query: {
      limit: opts.limit ?? DEFAULT_LIST_LIMIT,
      offset: opts.offset,
      name: opts.name || undefined,
      tag: opts.tag || undefined,
      type: opts.type || undefined,
      connector_type: opts.connectorType || undefined,
      enabled: opts.enabled === undefined ? undefined : String(opts.enabled),
      health_check_status: opts.healthCheckStatus || undefined,
      sort: opts.sort,
      direction: opts.direction,
    },
  });
  return ListCatalogsResponse.parse(result);
}

export async function getCatalog(
  ctx: RequestContext,
  id: string | string[],
): Promise<BatchCatalogsResponse> {
  const ids = Array.isArray(id) ? id : [id];
  const result = await request<unknown>(
    ctx,
    `${VEGA_BASE}/catalogs/${ids.map(encodeURIComponent).join(",")}`,
  );
  return BatchCatalogsResponse.parse(result);
}

/** Unwrap the first Catalog from the detail endpoint's batch envelope. */
export function firstCatalog(result: BatchCatalogsResponse): Catalog {
  const catalog = result.entries[0];
  if (!catalog) throw new InputError("catalog detail response contains no entries");
  return catalog;
}

/** POST /catalogs body. `connector_config` shape varies by connector (raw passthrough). */
export interface CreateCatalogRequest {
  name: string;
  connectorType: string;
  connectorConfig: Record<string, unknown>;
  tags?: string[];
  description?: string;
  enabled?: boolean;
  id?: string;
  internal?: boolean;
  healthCheckSchedule?: CatalogHealthCheckScheduleConfig | null;
}

/** Full PUT /catalogs/{id} body; the path id is injected by the API client. */
export interface UpdateCatalogRequest {
  name: string;
  connectorType: string;
  enabled: boolean;
  connectorConfig?: Record<string, unknown>;
  tags?: string[];
  description?: string;
  /** Required optimistic-lock version from the latest Catalog `update_time`. */
  expectedUpdateTime: number;
}

/** Create a Vega catalog (data source). Returns the created catalog (with its id). */
export function createCatalog(
  ctx: RequestContext,
  req: CreateCatalogRequest,
  opts: CatalogWriteOptions = {},
): Promise<CatalogRef> {
  return request<unknown>(ctx, `${VEGA_BASE}/catalogs`, {
    method: "POST",
    query: {
      allow_unhealthy: opts.allowUnhealthy === undefined ? undefined : String(opts.allowUnhealthy),
    },
    body: {
      ...(req.id ? { id: req.id } : {}),
      name: req.name,
      connector_type: req.connectorType,
      connector_config: req.connectorConfig,
      ...(req.tags !== undefined ? { tags: req.tags } : {}),
      ...(req.description !== undefined ? { description: req.description } : {}),
      ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
      ...(req.internal !== undefined ? { internal: req.internal } : {}),
      ...(req.healthCheckSchedule !== undefined
        ? {
            health_check_schedule:
              req.healthCheckSchedule === null
                ? null
                : mapCatalogHealthCheckScheduleConfig(req.healthCheckSchedule),
          }
        : {}),
    },
    timeoutMs: 60_000,
  }).then((result) => CatalogRef.parse(result));
}

export function updateCatalog(
  ctx: RequestContext,
  id: string,
  req: UpdateCatalogRequest,
  opts: CatalogWriteOptions = {},
): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}`, {
    method: "PUT",
    query: {
      allow_unhealthy: opts.allowUnhealthy === undefined ? undefined : String(opts.allowUnhealthy),
    },
    body: {
      id,
      name: req.name,
      connector_type: req.connectorType,
      enabled: req.enabled,
      ...(req.connectorConfig !== undefined ? { connector_config: req.connectorConfig } : {}),
      ...(req.tags !== undefined ? { tags: req.tags } : {}),
      ...(req.description !== undefined ? { description: req.description } : {}),
      expected_update_time: req.expectedUpdateTime,
    },
    timeoutMs: 60_000,
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

export async function deleteCatalog<T extends DeleteCatalogOptions | undefined = undefined>(
  ctx: RequestContext,
  id: string,
  opts?: T,
): Promise<DeleteCatalogResult<T>> {
  const result = await request<unknown>(ctx, `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}`, {
    method: "DELETE",
    query: { dry_run: opts?.dryRun === undefined ? undefined : String(opts.dryRun) },
  });
  if (opts?.dryRun) {
    const impact = CatalogDeletionImpact.safeParse(result);
    if (!impact.success) {
      const validationIssues = impact.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      throw new Error(
        `The server did not return a Catalog deletion impact for dry_run=true. It may not support deletion preflight; verify whether the Catalog still exists before retrying. Response validation failed — ${validationIssues}`,
      );
    }
    return impact.data as DeleteCatalogResult<T>;
  }
  return undefined as DeleteCatalogResult<T>;
}

export async function testCatalogConnectionConfig(
  ctx: RequestContext,
  req: CatalogConnectionTestRequest,
): Promise<CatalogConnectionTestResult> {
  const result = await request<unknown>(ctx, `${VEGA_BASE}/catalogs/test-connection`, {
    method: "POST",
    body: {
      connector_type: req.connectorType,
      connector_config: req.connectorConfig,
    },
    timeoutMs: 60_000,
  });
  return CatalogConnectionTestResult.parse(result);
}

export async function testCatalogConnection(
  ctx: RequestContext,
  id: string,
): Promise<CatalogConnectionTestResult> {
  const result = await request<unknown>(
    ctx,
    `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/test-connection`,
    {
      method: "POST",
      timeoutMs: 60_000,
    },
  );
  return CatalogConnectionTestResult.parse(result);
}

export async function getCatalogHealthCheckSchedule(
  ctx: RequestContext,
  id: string,
): Promise<CatalogHealthCheckSchedule> {
  const result = await request<unknown>(
    ctx,
    `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/health-check-schedule`,
  );
  return CatalogHealthCheckSchedule.parse(result);
}

export async function updateCatalogHealthCheckSchedule(
  ctx: RequestContext,
  id: string,
  req: CatalogHealthCheckScheduleRequest,
): Promise<CatalogHealthCheckSchedule> {
  const result = await request<unknown>(
    ctx,
    `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/health-check-schedule`,
    {
      method: "PUT",
      body: {
        ...mapCatalogHealthCheckScheduleConfig(req),
        expected_update_time: req.expectedUpdateTime,
      },
    },
  );
  return CatalogHealthCheckSchedule.parse(result);
}

function mapCatalogHealthCheckScheduleConfig(req: CatalogHealthCheckScheduleConfig) {
  return {
    mode: req.mode,
    ...(req.mode === "enabled" ? { cron_expr: req.cronExpr } : {}),
  };
}

/** Resources under a catalog (optionally filtered by category). */
export function listCatalogResources(
  ctx: RequestContext,
  id: string,
  category?: string,
  limit?: number,
  offset?: number,
): Promise<ListResourcesResult> {
  // The backend has no `/catalogs/:id/resources` route — resources are listed
  // via `/resources?catalog_id=…` (same endpoint as `resource list`). Without an
  // explicit `limit` this client sends its list default (30; backend range [1,1000]);
  // pass limit=-1 (NO_LIMIT) to fetch every resource.
  return request<unknown>(ctx, `${VEGA_BASE}/resources`, {
    query: {
      catalog_id: id,
      category: category || undefined,
      // limit=-1 (NO_LIMIT) fetches all; invalid values use the SDK list default.
      limit:
        limit === undefined
          ? DEFAULT_LIST_LIMIT
          : Number.isFinite(limit) && (limit > 0 || limit === -1)
            ? limit
            : DEFAULT_LIST_LIMIT,
      offset: offset || undefined,
    },
  }).then((result) => ListResourcesResponse.parse(result));
}

/** Fetch the latest health-check status for one catalog. */
export async function catalogHealthStatus(
  ctx: RequestContext,
  id: string,
): Promise<CatalogHealthStatus> {
  const result = await request<unknown>(
    ctx,
    `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/health-status`,
  );
  return CatalogHealthStatus.parse(result);
}

export function listConnectorTypes(ctx: RequestContext): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/connector-types`, {
    query: { sort: "name", direction: "asc" },
  });
}

export function getConnectorType(ctx: RequestContext, type: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/connector-types/${encodeURIComponent(type)}`);
}
