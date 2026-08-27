// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { z } from "zod";
/**
 * Vega-backend resource client (list/find/get/query/delete).
 * Responses passed through as parsed JSON.
 */
import { DEFAULT_LIST_LIMIT, type RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { request } from "./http.js";
import { resolveSmallModel } from "./models.js";

const BASE = "/api/vega-backend/v1/resources";

export interface PropertyFeature {
  name?: string;
  display_name?: string;
  feature_type: "keyword" | "fulltext" | "vector" | string;
  description?: string;
  ref_property?: string;
  is_default?: boolean;
  is_native?: boolean;
  config?: Record<string, unknown>;
}

export interface ResourceProperty {
  name: string;
  display_name?: string;
  type?: string;
  description?: string;
  original_name?: string;
  original_type?: string;
  original_description?: string;
  features?: PropertyFeature[];
  attributes?: Record<string, unknown>;
}

export interface ResourceIndexConfig {
  build_key_fields?: string[];
  default_fulltext_analyzer?: string;
  default_embedding_model?: string;
}

export const ResourceCategory = z.enum([
  "table",
  "file",
  "fileset",
  "api",
  "metric",
  "topic",
  "index",
  "logicview",
  "dataset",
]);
export type ResourceCategory = z.infer<typeof ResourceCategory>;

export const ResourceStatus = z.enum(["active", "disabled", "deprecated", "stale"]);
export type ResourceStatus = z.infer<typeof ResourceStatus>;

export const ResourceLocalStatus = z.enum(["unavailable", "available", "stale"]);
export type ResourceLocalStatus = z.infer<typeof ResourceLocalStatus>;

export interface ResourceLike {
  id?: string;
  catalog_id?: string;
  name?: string;
  tags?: string[];
  description?: string;
  category?: string;
  status?: string;
  schema?: string;
  source_identifier?: string;
  source_metadata?: Record<string, unknown>;
  schema_definition?: ResourceProperty[];
  index_config?: ResourceIndexConfig;
  logic_definition?: unknown;
  update_time?: number;
}

const ResourceAccountInfo = z
  .object({ id: z.string(), type: z.string(), name: z.string().optional() })
  .passthrough();

/**
 * Read JSON `null` as "the key is absent".
 *
 * A property with no features marshals as `features: null` rather than as a
 * missing key or an empty array, and zod's `.optional()` accepts only
 * `undefined` — so a plain optional rejects the response outright. That is why
 * `resource get` failed on nearly every id on both reference deploys, and why
 * `configureResourceIndex`, whose first act is that same read, could never run.
 *
 * Applied only where a null was actually observed, which is not everywhere it
 * could be: scanning all 368 resources on one deploy found exactly three, all
 * inside `schema_definition` — `attributes` 3578 times, `features` 4304, and a
 * feature's `config` 501. Every other optional came back omitted the ordinary
 * way, so the backend is selective rather than uniform about this, and a guard
 * placed where no null has been seen is a guard no fixture can hold up. If one
 * surfaces elsewhere, wrapping that field is the whole fix.
 *
 * Normalizing here rather than widening the types keeps "absent" a single shape
 * for callers, so `?? []` and `?.` keep meaning what they already meant.
 */
const nullAsAbsent = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((v) => v ?? undefined);

// The third parameter is the *input* type: what arrives on the wire, which is
// not what parsing yields. Leaving it pinned to `ResourceProperty` asserts the
// two are the same — the assumption this whole block exists to correct.
const ResourcePropertySchema: z.ZodType<ResourceProperty, z.ZodTypeDef, unknown> = z
  .object({
    name: z.string(),
    display_name: z.string().optional(),
    type: z.string().optional(),
    description: z.string().optional(),
    original_name: z.string().optional(),
    original_type: z.string().optional(),
    original_description: z.string().optional(),
    features: nullAsAbsent(
      z.array(
        z
          .object({
            name: z.string().optional(),
            display_name: z.string().optional(),
            feature_type: z.string(),
            description: z.string().optional(),
            ref_property: z.string().optional(),
            is_default: z.boolean().optional(),
            is_native: z.boolean().optional(),
            config: nullAsAbsent(z.record(z.unknown())),
          })
          .passthrough(),
      ),
    ),
    attributes: nullAsAbsent(z.record(z.unknown())),
  })
  .passthrough();

export const Resource = z
  .object({
    id: z.string(),
    catalog_id: z.string(),
    name: z.string().min(1),
    tags: z.array(z.string()).optional(),
    description: z.string().optional(),
    // Responses remain forward-compatible when the backend adds a category or
    // status; request options below remain constrained to known values.
    category: z.string(),
    status: z.string(),
    status_message: z.string().optional(),
    last_discover_status: z.string().optional(),
    schema: z.string().optional(),
    source_identifier: z.string(),
    source_metadata: z.record(z.unknown()).optional(),
    schema_definition: z.array(ResourcePropertySchema).optional(),
    index_config: z
      .object({
        build_key_fields: z.array(z.string()).optional(),
        default_fulltext_analyzer: z.string().optional(),
        default_embedding_model: z.string().optional(),
      })
      .passthrough()
      .optional(),
    // Optional: neither reference deploy sends the key at all, so requiring it
    // rejects every resource read against them. Still an enum when present —
    // a deploy that reports the state must report one this SDK knows.
    local_status: ResourceLocalStatus.optional(),
    index_name: z.string().optional(),
    column_count: z.number().optional(),
    row_count: z.number().optional(),
    logic_type: z.string().optional(),
    logic_definition: z.unknown().optional(),
    creator: ResourceAccountInfo,
    create_time: z.number(),
    updater: ResourceAccountInfo,
    update_time: z.number(),
    operations: z.array(z.string()).optional(),
  })
  .passthrough();
export type Resource = z.infer<typeof Resource>;

/** Resource fields returned by list endpoints; extended JSON fields require a detail read. */
export const ResourceSummary = Resource.omit({
  source_metadata: true,
  schema_definition: true,
  index_config: true,
  logic_definition: true,
});
export type ResourceSummary = z.infer<typeof ResourceSummary>;

export const ListResourcesResponse = z
  .object({ entries: z.array(ResourceSummary), total_count: z.number() })
  .passthrough();
export type ListResourcesResponse = z.infer<typeof ListResourcesResponse>;

export const BatchResourcesResponse = z.object({ entries: z.array(Resource) }).passthrough();
export type BatchResourcesResponse = z.infer<typeof BatchResourcesResponse>;

export interface ListResourcesOptions {
  catalogId?: string;
  name?: string;
  /** Resource category, e.g. table | logicview. */
  category?: ResourceCategory;
  status?: ResourceStatus;
  schema?: string;
  limit?: number;
  offset?: number;
  sort?: "name" | "create_time" | "update_time";
  direction?: "asc" | "desc";
}

export async function listResources(
  ctx: RequestContext,
  opts: ListResourcesOptions = {},
): Promise<ListResourcesResponse> {
  const result = await request<unknown>(ctx, BASE, {
    query: {
      catalog_id: opts.catalogId || undefined,
      name: opts.name || undefined,
      category: opts.category || undefined,
      status: opts.status || undefined,
      schema: opts.schema || undefined,
      // Same `/resources` endpoint as `catalogResources`: limit=-1 (NO_LIMIT)
      // fetches every row; any other non-positive/invalid value uses the SDK
      // list default.
      limit:
        opts.limit === undefined
          ? DEFAULT_LIST_LIMIT
          : Number.isFinite(opts.limit) && (opts.limit > 0 || opts.limit === -1)
            ? opts.limit
            : DEFAULT_LIST_LIMIT,
      offset: opts.offset,
      sort: opts.sort,
      direction: opts.direction,
    },
  });
  return ListResourcesResponse.parse(result);
}

export async function getResource(
  ctx: RequestContext,
  id: string | string[],
  opts: { ignoreMissing?: boolean } = {},
): Promise<BatchResourcesResponse> {
  const ids = Array.isArray(id) ? id : [id];
  const result = await request<unknown>(ctx, `${BASE}/${ids.map(encodeURIComponent).join(",")}`, {
    query: {
      ignore_missing: opts.ignoreMissing === undefined ? undefined : String(opts.ignoreMissing),
    },
  });
  return BatchResourcesResponse.parse(result);
}

/** Create a vega-backend resource from a fully-formed body (e.g. a rendered template). */
export function createResourceRaw(ctx: RequestContext, body: unknown): Promise<unknown> {
  return request(ctx, BASE, { method: "POST", body });
}

export interface CreateResourceRequest {
  catalogId: string;
  name: string;
  category: Extract<ResourceCategory, "dataset" | "logicview">;
  id?: string;
  tags?: string[];
  description?: string;
  status?: ResourceStatus;
  schema?: string;
  sourceIdentifier?: string;
  sourceMetadata?: Record<string, unknown>;
  schemaDefinition?: ResourceProperty[];
  indexConfig?: ResourceIndexConfig;
  logicDefinition?: unknown;
}

export async function createResource(
  ctx: RequestContext,
  req: CreateResourceRequest,
): Promise<Resource> {
  const result = await createResourceRaw(ctx, {
    ...(req.id !== undefined ? { id: req.id } : {}),
    catalog_id: req.catalogId,
    name: req.name,
    category: req.category,
    ...(req.tags !== undefined ? { tags: req.tags } : {}),
    ...(req.description !== undefined ? { description: req.description } : {}),
    ...(req.status !== undefined ? { status: req.status } : {}),
    ...(req.schema !== undefined ? { schema: req.schema } : {}),
    ...(req.sourceIdentifier !== undefined ? { source_identifier: req.sourceIdentifier } : {}),
    ...(req.sourceMetadata !== undefined ? { source_metadata: req.sourceMetadata } : {}),
    ...(req.schemaDefinition !== undefined ? { schema_definition: req.schemaDefinition } : {}),
    ...(req.indexConfig !== undefined ? { index_config: req.indexConfig } : {}),
    ...(req.logicDefinition !== undefined ? { logic_definition: req.logicDefinition } : {}),
  });
  return Resource.parse(result);
}

export interface UpdateResourceOptions {
  name?: string;
  tags?: string[];
  description?: string;
  schemaDefinition?: ResourceProperty[];
  indexConfig?: ResourceIndexConfig;
  logicDefinition?: unknown;
  /** Optimistic-lock version from an earlier Resource `update_time`. */
  expectedUpdateTime?: number;
}

export function updateResourceRaw(
  ctx: RequestContext,
  id: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, `${BASE}/${encodeURIComponent(id)}`, { method: "PUT", body });
}

export async function updateResource(
  ctx: RequestContext,
  id: string,
  patch: UpdateResourceOptions,
): Promise<unknown> {
  const current = firstResource(await getResource(ctx, id));
  return updateResourceRaw(ctx, id, resourceUpdateBody(id, current, patch));
}

export interface ConfigureResourceIndexOptions {
  buildKeyFields?: string[];
  embeddingFields?: string[];
  embeddingModel?: string;
  fulltextFields?: string[];
  fulltextAnalyzer?: string;
}

/**
 * Write index intent onto a resource: build keys, vector/fulltext features, and
 * the analyzer/model defaults.
 *
 * Deliberately reaches into mf-model-manager to resolve `embeddingModel`, which
 * ARCHITECTURE.md would place in `resources/`. The exception is intentional:
 * all four build entry points (`bkn push --build`, `create-from-catalog
 * --build`, `vega dataset build`) funnel through
 * here, so resolving once beats four call sites drifting apart. Keep it here.
 */
export async function configureResourceIndex(
  ctx: RequestContext,
  id: string,
  opts: ConfigureResourceIndexOptions,
): Promise<unknown> {
  const current = firstResource(await getResource(ctx, id));
  // The two places a model lands want it in different forms, and each rejects
  // the other's: `index_config.default_embedding_model` takes the NAME (an id
  // fails the build with `embedding model "…" not found`), while a feature's
  // `config.embedding_model` takes the numeric ID (a name fails the PUT itself
  // with `embedding model ID "…" for field "…" not found`). Resolve once, use
  // each where it belongs.
  const model = opts.embeddingModel ? await resolveSmallModel(ctx, opts.embeddingModel) : undefined;
  const schema = (current.schema_definition ?? []).map((prop) => ({ ...prop }));
  const indexConfig: ResourceIndexConfig = {
    ...(current.index_config ?? {}),
    ...(opts.buildKeyFields?.length ? { build_key_fields: opts.buildKeyFields } : {}),
    ...(model ? { default_embedding_model: model.name } : {}),
    ...(opts.fulltextAnalyzer ? { default_fulltext_analyzer: opts.fulltextAnalyzer } : {}),
  };

  for (const field of opts.embeddingFields ?? []) {
    ensureFeature(schema, field, "vector", model ? { embedding_model: model.id } : undefined);
  }
  for (const field of opts.fulltextFields ?? []) {
    ensureFeature(
      schema,
      field,
      "fulltext",
      opts.fulltextAnalyzer ? { analyzer: opts.fulltextAnalyzer } : undefined,
    );
  }

  return updateResourceRaw(
    ctx,
    id,
    resourceUpdateBody(id, current, { schemaDefinition: schema, indexConfig }),
  );
}

function resourceUpdateBody(
  id: string,
  current: ResourceLike,
  patch: UpdateResourceOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id,
    name: patch.name ?? current.name,
    catalog_id: current.catalog_id,
    tags: patch.tags ?? current.tags ?? [],
    description: patch.description ?? current.description ?? "",
    category: current.category,
    schema_definition: patch.schemaDefinition ?? current.schema_definition,
    index_config: patch.indexConfig === undefined ? current.index_config : patch.indexConfig,
    logic_definition: patch.logicDefinition ?? current.logic_definition,
  };
  const expectedUpdateTime = patch.expectedUpdateTime ?? current.update_time;
  if (expectedUpdateTime !== undefined) {
    body.expected_update_time = expectedUpdateTime;
  }
  return body;
}

/**
 * `ref_property` for a feature that indexes the column it hangs on.
 *
 * The field names where the indexed content comes from, and for in-place
 * indexing there is no second column to name — so the platform leaves it empty,
 * and its validator reads a feature whose `ref_property` equals its own
 * column as an illegal self-reference. Writing the column name there is what
 * made every index build fail: 90 features across both reference deploys carry
 * `""` and not one carries a self-reference.
 */
const IN_PLACE = "";

function ensureFeature(
  schema: ResourceProperty[],
  field: string,
  featureType: "vector" | "fulltext",
  config?: Record<string, unknown>,
) {
  const prop = schema.find((p) => p.name === field);
  if (!prop) throw new Error(`resource field '${field}' not found in schema_definition`);
  const features = [...(prop.features ?? [])];
  const existing = features.find(
    (f) => f.feature_type === featureType && (f.ref_property || field) === field,
  );
  if (existing) {
    // Left alone on purpose. Setting it to `field` here rewrote a stored `""`
    // into the shape the validator rejects, so a resource the platform had
    // accepted became unwritable the next time anything touched its index.
    existing.config = { ...(existing.config ?? {}), ...(config ?? {}) };
  } else {
    features.push({
      name: `${field}_${featureType}`,
      feature_type: featureType,
      ref_property: IN_PLACE,
      is_default: false,
      is_native: false,
      ...(config ? { config } : {}),
    });
  }
  prop.features = features;
}

/**
 * Unwrap a single-resource response. `GET /resources/{id}` answers with the same
 * `{entries:[…]}` envelope as the list endpoint, so reading the response as the
 * resource itself silently yields a nameless, column-less object — callers must
 * go through here.
 */
export function firstResource<T extends object = Resource>(result: BatchResourcesResponse): T {
  const resource = result.entries[0];
  if (!resource) throw new InputError("resource detail response contains no entries");
  return resource as T;
}

export interface DeleteResourceOptions {
  ignoreMissing?: boolean;
}

export function deleteResource(
  ctx: RequestContext,
  id: string | string[],
  opts: DeleteResourceOptions = {},
): Promise<unknown> {
  const ids = Array.isArray(id) ? id : [id];
  return request(ctx, `${BASE}/${ids.map(encodeURIComponent).join(",")}`, {
    method: "DELETE",
    query: {
      ignore_missing: opts.ignoreMissing === undefined ? undefined : String(opts.ignoreMissing),
    },
  });
}

export interface FindResourceOptions {
  catalogId?: string;
  /** Exact name match instead of fuzzy. */
  exact?: boolean;
  /** Rows to fetch before filtering; `-1` = all. Defaults to the list default. */
  limit?: number;
}

/** Search resources by name (fuzzy by default; exact filters client-side). */
export async function findResource(
  ctx: RequestContext,
  name: string,
  opts: FindResourceOptions = {},
): Promise<ResourceSummary[]> {
  const result = await listResources(ctx, {
    name,
    catalogId: opts.catalogId,
    limit: opts.limit,
  });
  return opts.exact ? result.entries.filter((resource) => resource.name === name) : result.entries;
}

export interface QueryResourceOptions {
  limit?: number;
  offset?: number;
  needTotal?: boolean;
  pagingMode?: "single" | "cursor";
  keepAliveSec?: number;
  /** Opaque cursor returned by the preceding resource data page. */
  cursor?: string;
  filterCondition?: Record<string, unknown>;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  outputFields?: string[];
  aggregation?: {
    property: string;
    aggr: "count" | "count_distinct" | "sum" | "max" | "min" | "avg";
    alias?: string;
  };
  groupBy?: Array<{
    property: string;
    description?: string;
    calendarInterval?: "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
  }>;
  having?: {
    field: "__value" | "count(*)";
    operation: "==" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "not_in" | "range" | "out_range";
    value: unknown;
  };
}

export type ResourceDocument = Record<string, unknown> & { id?: string };

export interface ResourceDataPaging {
  next_cursor: string | null;
  expires_at_sec: number | null;
}

export interface QueryResourceResponse {
  entries: ResourceDocument[];
  total_count?: number;
  paging?: ResourceDataPaging;
  warnings?: string[];
  [key: string]: unknown;
}

export function queryResource(
  ctx: RequestContext,
  id: string,
  opts: QueryResourceOptions = {},
): Promise<QueryResourceResponse> {
  const body = opts.cursor
    ? {
        paging: { cursor: opts.cursor },
        need_total: opts.needTotal ?? false,
      }
    : {
        ...(opts.filterCondition !== undefined ? { filter_condition: opts.filterCondition } : {}),
        paging: {
          mode: opts.pagingMode ?? "single",
          limit: opts.limit ?? 50,
          offset: opts.offset ?? 0,
          ...(opts.keepAliveSec !== undefined ? { keep_alive_sec: opts.keepAliveSec } : {}),
        },
        ...(opts.sort !== undefined ? { sort: opts.sort } : {}),
        ...(opts.outputFields !== undefined ? { output_fields: opts.outputFields } : {}),
        need_total: opts.needTotal ?? false,
        ...(opts.aggregation !== undefined ? { aggregation: opts.aggregation } : {}),
        ...(opts.groupBy !== undefined
          ? {
              group_by: opts.groupBy.map((item) => ({
                property: item.property,
                ...(item.description !== undefined ? { description: item.description } : {}),
                ...(item.calendarInterval !== undefined
                  ? { calendar_interval: item.calendarInterval }
                  : {}),
              })),
            }
          : {}),
        ...(opts.having !== undefined ? { having: opts.having } : {}),
      };
  return request<QueryResourceResponse>(ctx, `${BASE}/${encodeURIComponent(id)}/data`, {
    method: "POST",
    headers: { "X-HTTP-Method-Override": "GET" },
    body,
    responseParser: parseBigIntJSON,
  });
}

export async function createResourceDocuments(
  ctx: RequestContext,
  resourceId: string,
  documents: ResourceDocument[],
): Promise<{ ids: string[] }> {
  const result = await request<unknown>(ctx, `${BASE}/${encodeURIComponent(resourceId)}/data`, {
    method: "POST",
    headers: { "X-HTTP-Method-Override": "POST" },
    body: documents,
  });
  return z
    .object({ ids: z.array(z.string()) })
    .passthrough()
    .parse(result);
}

export async function upsertResourceDocuments(
  ctx: RequestContext,
  resourceId: string,
  documents: Array<ResourceDocument & { id: string }>,
): Promise<{ ids: string[] }> {
  const result = await request<unknown>(ctx, `${BASE}/${encodeURIComponent(resourceId)}/data`, {
    method: "PUT",
    body: documents,
  });
  return z
    .object({ ids: z.array(z.string()) })
    .passthrough()
    .parse(result);
}

export async function getResourceDocument(
  ctx: RequestContext,
  resourceId: string,
  documentId: string,
): Promise<ResourceDocument> {
  const result = await request<unknown>(
    ctx,
    `${BASE}/${encodeURIComponent(resourceId)}/data/${encodeURIComponent(documentId)}`,
    { responseParser: parseBigIntJSON },
  );
  return z.record(z.unknown()).parse(result);
}

export async function upsertResourceDocument(
  ctx: RequestContext,
  resourceId: string,
  documentId: string,
  document: ResourceDocument,
): Promise<{ id: string }> {
  const result = await request<unknown>(
    ctx,
    `${BASE}/${encodeURIComponent(resourceId)}/data/${encodeURIComponent(documentId)}`,
    { method: "PUT", body: document },
  );
  return z.object({ id: z.string() }).passthrough().parse(result);
}

export function deleteResourceDocuments(
  ctx: RequestContext,
  resourceId: string,
  documentIds: string | string[],
): Promise<unknown> {
  const ids = Array.isArray(documentIds) ? documentIds : [documentIds];
  return request(
    ctx,
    `${BASE}/${encodeURIComponent(resourceId)}/data/${ids.map(encodeURIComponent).join(",")}`,
    { method: "DELETE" },
  );
}

export async function deleteResourceDocumentsByFilter(
  ctx: RequestContext,
  resourceId: string,
  filterCondition: Record<string, unknown>,
): Promise<unknown> {
  if (Object.keys(filterCondition).length === 0) {
    throw new InputError("delete-by-filter requires a non-empty filter condition");
  }
  return request(ctx, `${BASE}/${encodeURIComponent(resourceId)}/data`, {
    method: "POST",
    headers: { "X-HTTP-Method-Override": "DELETE" },
    body: { filter_condition: filterCondition },
  });
}
