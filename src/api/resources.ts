// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Vega-backend resource client (list/find/get/query/delete).
 * Responses passed through as parsed JSON.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

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
  extensions?: Record<string, string>;
}

export interface ResourceIndexConfig {
  build_key_fields?: string[];
  default_fulltext_analyzer?: string;
  default_embedding_model?: string;
}

export interface ResourceLike {
  id?: string;
  catalog_id?: string;
  name?: string;
  tags?: string[];
  description?: string;
  category?: string;
  status?: string;
  database?: string;
  source_identifier?: string;
  source_metadata?: Record<string, unknown>;
  schema_definition?: ResourceProperty[];
  index_config?: ResourceIndexConfig;
  logic_definition?: unknown;
  extensions?: Record<string, string>;
}

export interface ListResourcesOptions {
  datasourceId?: string;
  name?: string;
  /** Resource category, e.g. table | logicview. */
  category?: string;
  status?: string;
  database?: string;
  limit?: number;
  offset?: number;
  sort?: "name" | "create_time" | "update_time" | string;
  direction?: "asc" | "desc";
  includeExtensions?: boolean;
  includeExtensionKeys?: string;
  extensionPairs?: Array<{ key: string; value: string }>;
}

export function listResources(
  ctx: RequestContext,
  opts: ListResourcesOptions = {},
): Promise<unknown> {
  return request(ctx, BASE, {
    query: {
      catalog_id: opts.datasourceId || undefined,
      name: opts.name || undefined,
      category: opts.category || undefined,
      status: opts.status || undefined,
      database: opts.database || undefined,
      limit: opts.limit && opts.limit > 0 ? opts.limit : undefined,
      offset: opts.offset,
      sort: opts.sort,
      direction: opts.direction,
      include_extensions:
        opts.includeExtensions === undefined ? undefined : String(opts.includeExtensions),
      include_extension_keys: opts.includeExtensionKeys || undefined,
      extension_key: opts.extensionPairs?.map((p) => p.key),
      extension_value: opts.extensionPairs?.map((p) => p.value),
    },
  });
}

export function getResource(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${BASE}/${encodeURIComponent(id)}`);
}

/** Create a vega-backend resource from a fully-formed body (e.g. a rendered template). */
export function createResourceRaw(ctx: RequestContext, body: unknown): Promise<unknown> {
  return request(ctx, BASE, { method: "POST", body });
}

export interface UpdateResourceOptions {
  name?: string;
  catalogId?: string;
  tags?: string[];
  description?: string;
  category?: string;
  status?: string;
  database?: string;
  sourceIdentifier?: string;
  sourceMetadata?: Record<string, unknown>;
  schemaDefinition?: ResourceProperty[];
  indexConfig?: ResourceIndexConfig | null;
  logicDefinition?: unknown;
  extensions?: Record<string, string>;
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

export async function configureResourceIndex(
  ctx: RequestContext,
  id: string,
  opts: ConfigureResourceIndexOptions,
): Promise<unknown> {
  const current = firstResource(await getResource(ctx, id));
  const schema = (current.schema_definition ?? []).map((prop) => ({ ...prop }));
  const indexConfig: ResourceIndexConfig = {
    ...(current.index_config ?? {}),
    ...(opts.buildKeyFields?.length ? { build_key_fields: opts.buildKeyFields } : {}),
    ...(opts.embeddingModel ? { default_embedding_model: opts.embeddingModel } : {}),
    ...(opts.fulltextAnalyzer ? { default_fulltext_analyzer: opts.fulltextAnalyzer } : {}),
  };

  for (const field of opts.embeddingFields ?? []) {
    ensureFeature(
      schema,
      field,
      "vector",
      opts.embeddingModel ? { embedding_model: opts.embeddingModel } : undefined,
    );
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
    catalog_id: patch.catalogId ?? current.catalog_id,
    tags: patch.tags ?? current.tags ?? [],
    description: patch.description ?? current.description ?? "",
    category: patch.category ?? current.category,
    status: patch.status ?? current.status,
    database: patch.database ?? current.database,
    source_identifier: patch.sourceIdentifier ?? current.source_identifier,
    source_metadata: patch.sourceMetadata ?? current.source_metadata,
    schema_definition: patch.schemaDefinition ?? current.schema_definition,
    index_config: patch.indexConfig === undefined ? current.index_config : patch.indexConfig,
    logic_definition: patch.logicDefinition ?? current.logic_definition,
  };
  if (patch.extensions !== undefined || current.extensions !== undefined) {
    body.extensions = patch.extensions ?? current.extensions;
  }
  return body;
}

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
    existing.ref_property = existing.ref_property || field;
    existing.config = { ...(existing.config ?? {}), ...(config ?? {}) };
  } else {
    features.push({
      name: `${field}_${featureType}`,
      feature_type: featureType,
      ref_property: field,
      is_default: false,
      is_native: false,
      ...(config ? { config } : {}),
    });
  }
  prop.features = features;
}

function firstResource(result: unknown): ResourceLike {
  if (result && typeof result === "object") {
    const o = result as Record<string, unknown>;
    if (Array.isArray(o.entries)) return (o.entries[0] ?? {}) as ResourceLike;
    return o as ResourceLike;
  }
  return {};
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
  datasourceId?: string;
  /** Exact name match instead of fuzzy. */
  exact?: boolean;
}

/** Search resources by name (fuzzy by default; exact filters client-side). */
export async function findResource(
  ctx: RequestContext,
  name: string,
  opts: FindResourceOptions = {},
): Promise<unknown> {
  const result = (await listResources(ctx, { name, datasourceId: opts.datasourceId })) as
    | { entries?: Array<{ name?: string }> }
    | Array<{ name?: string }>;
  const list = Array.isArray(result) ? result : (result.entries ?? []);
  return opts.exact ? list.filter((r) => r.name === name) : list;
}

export interface QueryResourceOptions {
  limit?: number;
  offset?: number;
  needTotal?: boolean;
  pagingMode?: "single" | "cursor";
  keepAliveSec?: number;
  /** Opaque cursor returned by the preceding resource data page. */
  cursor?: string;
}

export function queryResource(
  ctx: RequestContext,
  id: string,
  opts: QueryResourceOptions = {},
): Promise<unknown> {
  const body = opts.cursor
    ? {
        paging: { cursor: opts.cursor },
        need_total: opts.needTotal ?? false,
      }
    : {
        paging: {
          mode: opts.pagingMode ?? "single",
          limit: opts.limit ?? 50,
          offset: opts.offset ?? 0,
          ...(opts.keepAliveSec !== undefined ? { keep_alive_sec: opts.keepAliveSec } : {}),
        },
        need_total: opts.needTotal ?? false,
      };
  return request(ctx, `${BASE}/${encodeURIComponent(id)}/data`, {
    method: "POST",
    headers: { "X-HTTP-Method-Override": "GET" },
    body,
  });
}
