/**
 * Vega backend client — catalog/resource reads + BuildTask (index build).
 * Build config lives on the task (CreateBuildTaskRequest), per the platform model.
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
  embedding_fields: z.array(z.string()).optional(),
  build_key_fields: z.array(z.string()).optional(),
  embedding_model: z.string().optional(),
  model_dimensions: z.number().int().positive().optional(),
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
    embedding_fields: z.string().optional(),
    build_key_fields: z.string().optional(),
    embedding_model: z.string().optional(),
    model_dimensions: z.number().optional(),
  })
  .passthrough();
export type BuildTask = z.infer<typeof BuildTask>;

/** Create an index BuildTask for a resource. Returns the task (with its id). */
export async function createBuildTask(
  ctx: RequestContext,
  req: CreateBuildTaskRequest,
): Promise<BuildTask> {
  const p = CreateBuildTaskRequest.parse(req);
  // The backend takes embedding_fields / build_key_fields as comma-joined
  // strings, not arrays — keep the SDK surface ergonomic, serialize here.
  const body = {
    resource_id: p.resource_id,
    mode: p.mode,
    ...(p.embedding_fields?.length ? { embedding_fields: p.embedding_fields.join(",") } : {}),
    ...(p.build_key_fields?.length ? { build_key_fields: p.build_key_fields.join(",") } : {}),
    ...(p.embedding_model ? { embedding_model: p.embedding_model } : {}),
    ...(p.model_dimensions ? { model_dimensions: p.model_dimensions } : {}),
  };
  const res = await request<unknown>(ctx, `${VEGA_BASE}/build-tasks`, { method: "POST", body });
  return BuildTask.parse(res);
}

/** Fetch a BuildTask's progress/state. */
export async function getBuildTask(ctx: RequestContext, taskId: string): Promise<BuildTask> {
  const res = await request<unknown>(ctx, `${VEGA_BASE}/build-tasks/${encodeURIComponent(taskId)}`);
  return BuildTask.parse(res);
}

export interface SqlQueryRequest {
  /** SQL string (MySQL/MariaDB/PostgreSQL) or an OpenSearch DSL object. */
  query: string | Record<string, unknown>;
  /**
   * Source type (mysql | mariadb | postgresql | opensearch …). Optional — when
   * the query carries a `{{<resource-id>}}` placeholder the backend infers the
   * type from that resource's Catalog connector. Pass it only to override.
   */
  resource_type?: string;
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
}

/** List catalog entries (raw passthrough — shape varies by backend). */
export async function listCatalogs(
  ctx: RequestContext,
  opts: ListCatalogsOptions = {},
): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs`, {
    query: { limit: opts.limit, offset: opts.offset },
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
}

/** Create a Vega catalog (data source). Returns the created catalog (with its id). */
export function createCatalog(ctx: RequestContext, req: CreateCatalogRequest): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs`, {
    method: "POST",
    body: {
      name: req.name,
      connector_type: req.connectorType,
      connector_config: req.connectorConfig,
      ...(req.tags ? { tags: req.tags } : {}),
      ...(req.description ? { description: req.description } : {}),
      ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
    },
  });
}

/** Enable a catalog (catalogs are created disabled; discovery needs it enabled). */
export function enableCatalog(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs/${encodeURIComponent(id)}/enable`, { method: "POST" });
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
): Promise<unknown> {
  // The backend has no `/catalogs/:id/resources` route — resources are listed
  // via `/resources?catalog_id=…` (same endpoint as `resource list`).
  return request(ctx, `${VEGA_BASE}/resources`, {
    query: { catalog_id: id, category: category || undefined },
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
