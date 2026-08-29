// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Knowledge-network backend client (bkn-backend + ontology-query + agent-retrieval).
 * `/api/ontology-manager/v1` is a compat alias of `/api/bkn-backend/v1`; the
 * canonical prefix is the latter.
 * Responses are passed through as parsed JSON
 * (shapes vary by backend version — validate at higher layers as needed).
 */
import type { RequestContext } from "../types.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { request } from "./http.js";
import { type BknContext, withManagedLifecycle } from "./lifecycle.js";

const ONTOLOGY_BASE = "/api/bkn-backend/v1/knowledge-networks";
const ONTOLOGY_QUERY_BASE = "/api/ontology-query/v1/knowledge-networks";
const RETRIEVAL_BASE = "/api/agent-retrieval/v1/kn";

export interface ListKnOptions {
  offset?: number;
  limit?: number;
  sort?: string;
  direction?: "asc" | "desc";
  namePattern?: string;
  tag?: string;
}

export function listKnowledgeNetworks(
  ctx: RequestContext,
  opts: ListKnOptions = {},
): Promise<unknown> {
  return request(ctx, ONTOLOGY_BASE, {
    query: {
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 30,
      sort: opts.sort ?? "update_time",
      direction: opts.direction ?? "desc",
      name_pattern: opts.namePattern || undefined,
      tag: opts.tag || undefined,
    },
  });
}

export interface GetKnOptions {
  /** Return the full export payload. */
  exportMode?: boolean;
  /** Include statistics in the response. */
  stats?: boolean;
}

export function getKnowledgeNetwork(
  ctx: RequestContext,
  knId: string,
  opts: GetKnOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}`, {
    query: {
      mode: opts.exportMode ? "export" : undefined,
      include_statistics: opts.stats ? "true" : undefined,
    },
  });
}

export interface CreateKnOptions {
  name: string;
  branch?: string;
  baseBranch?: string;
}

/** Create a knowledge network from a fully-formed body (e.g. a rendered template). */
export function createKnowledgeNetworkRaw(ctx: RequestContext, body: unknown): Promise<unknown> {
  return request(ctx, ONTOLOGY_BASE, { method: "POST", body });
}

export function createKnowledgeNetwork(
  ctx: RequestContext,
  opts: CreateKnOptions,
): Promise<unknown> {
  return request(ctx, ONTOLOGY_BASE, {
    method: "POST",
    body: { name: opts.name, branch: opts.branch ?? "main", base_branch: opts.baseBranch ?? "" },
  });
}

export function deleteKnowledgeNetwork(ctx: RequestContext, knId: string): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}`, { method: "DELETE" });
}

export function updateKnowledgeNetwork(
  ctx: RequestContext,
  knId: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}`, { method: "PUT", body });
}

/**
 * Reads that carry a JSON query body. The backend models them as GETs tunnelled
 * over POST and rejects the request outright without the override header
 * (`NullParameter.OverrideMethod`).
 */
const QUERY_OVER_POST = { "X-HTTP-Method-Override": "GET" } as const;

/** Query a subgraph (ontology-query). Body is a JSON query passthrough. */
export function querySubgraph(ctx: RequestContext, knId: string, body: unknown): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/subgraph`, {
    method: "POST",
    headers: QUERY_OVER_POST,
    body,
    responseParser: parseBigIntJSON,
  });
}

export interface ActionLogListOptions {
  actionTypeId?: string;
  status?: string;
  triggerType?: string;
  limit?: number;
  needTotal?: boolean;
}

export function listActionLogs(
  ctx: RequestContext,
  knId: string,
  opts: ActionLogListOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/action-logs`, {
    query: {
      action_type_id: opts.actionTypeId || undefined,
      status: opts.status || undefined,
      trigger_type: opts.triggerType || undefined,
      limit: opts.limit ?? 30,
      need_total: opts.needTotal ? "true" : undefined,
    },
    responseParser: parseBigIntJSON,
  });
}

export function getActionLog(ctx: RequestContext, knId: string, logId: string): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/action-logs/${encodeURIComponent(logId)}`,
    { responseParser: parseBigIntJSON },
  );
}

export function cancelActionLog(
  ctx: RequestContext,
  knId: string,
  logId: string,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/action-logs/${encodeURIComponent(logId)}/cancel`,
    { method: "POST" },
  );
}

/** Query instances of an object type (ontology-query). Body is a JSON query. */
export function queryObjectTypeInstances(
  ctx: RequestContext,
  knId: string,
  otId: string,
  body: unknown,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/object-types/${encodeURIComponent(otId)}`,
    { method: "POST", headers: QUERY_OVER_POST, body, responseParser: parseBigIntJSON },
  );
}

/** Query an action type (ontology-query). Body is a JSON query passthrough. */
export function queryActionType(
  ctx: RequestContext,
  knId: string,
  atId: string,
  body: unknown,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/action-types/${encodeURIComponent(atId)}/`,
    { method: "POST", body, responseParser: parseBigIntJSON },
  );
}

/** Execute an action type (ontology-query). Body is the execution envelope. */
export function executeActionType(
  ctx: RequestContext,
  knId: string,
  atId: string,
  body: unknown,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/action-types/${encodeURIComponent(atId)}/execute`,
    { method: "POST", body, responseParser: parseBigIntJSON },
  );
}

export function getActionExecution(
  ctx: RequestContext,
  knId: string,
  executionId: string,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/action-executions/${encodeURIComponent(executionId)}`,
    { responseParser: parseBigIntJSON },
  );
}

/** Query a metric's data (ontology-query). Body is a JSON query passthrough. */
export function queryMetricData(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  body: unknown,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/metrics/${encodeURIComponent(metricId)}/data`,
    { method: "POST", body, responseParser: parseBigIntJSON },
  );
}

/** Dry-run a metric definition (ontology-query). */
export function dryRunMetric(ctx: RequestContext, knId: string, body: unknown): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/metrics/dry-run`, {
    method: "POST",
    body,
    responseParser: parseBigIntJSON,
  });
}

export interface ListSchemaOptions {
  branch?: string;
  /** -1 = all (backend default). */
  limit?: number;
}

function schemaListQuery(opts: ListSchemaOptions) {
  return { branch: opts.branch ?? "main", limit: String(opts.limit ?? -1) };
}

export function listObjectTypes(
  ctx: RequestContext,
  knId: string,
  opts: ListSchemaOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/object-types`, {
    query: schemaListQuery(opts),
  });
}

/** Batch-create object types in one all-or-nothing transaction (`{entries:[…]}`). */
export function createObjectTypes(
  ctx: RequestContext,
  knId: string,
  entries: unknown[],
  branch = "main",
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/object-types`, {
    method: "POST",
    query: { branch },
    body: { entries },
  });
}

export function listRelationTypes(
  ctx: RequestContext,
  knId: string,
  opts: ListSchemaOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/relation-types`, {
    query: schemaListQuery(opts),
  });
}

export function listActionTypes(
  ctx: RequestContext,
  knId: string,
  opts: ListSchemaOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/action-types`, {
    query: schemaListQuery(opts),
  });
}

/** Schema item kind in the bkn-backend schema path. */
export type SchemaKind = "object-types" | "relation-types" | "action-types";

export function getSchemaItem(
  ctx: RequestContext,
  knId: string,
  kind: SchemaKind,
  id: string,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/${kind}/${encodeURIComponent(id)}`,
  );
}
export function createSchemaItem(
  ctx: RequestContext,
  knId: string,
  kind: SchemaKind,
  body: unknown,
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/${kind}`, {
    method: "POST",
    body,
  });
}
export function updateSchemaItem(
  ctx: RequestContext,
  knId: string,
  kind: SchemaKind,
  id: string,
  body: unknown,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/${kind}/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body,
    },
  );
}
export function deleteSchemaItem(
  ctx: RequestContext,
  knId: string,
  kind: SchemaKind,
  id: string,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/${kind}/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
}

// Metric definitions live under bkn-backend (data/dry-run are query-side).
export function listMetrics(
  ctx: RequestContext,
  knId: string,
  opts: ListSchemaOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics`, {
    query: { branch: opts.branch ?? "main", limit: String(opts.limit ?? -1) },
  });
}
export function getMetric(ctx: RequestContext, knId: string, metricId: string): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics/${encodeURIComponent(metricId)}`,
  );
}
export function createMetric(ctx: RequestContext, knId: string, body: unknown): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics`, {
    method: "POST",
    body,
  });
}
export function updateMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  body: unknown,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics/${encodeURIComponent(metricId)}`,
    {
      method: "PUT",
      body,
    },
  );
}
export function deleteMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics/${encodeURIComponent(metricId)}`,
    {
      method: "DELETE",
    },
  );
}
export function validateMetric(ctx: RequestContext, knId: string, body: unknown): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics/validation`, {
    method: "POST",
    body,
  });
}

export interface SearchInstanceOptions {
  /** Restrict recall to these concept groups. */
  conceptGroups?: string[];
  /** Pin recall to these object-type ids (ids, not names). */
  objectTypes?: string[];
  /** Drop these object-type ids from recall; wins over `objectTypes` on overlap. */
  excludeObjectTypes?: string[];
  /** How many object types may take part. Each one costs a downstream query. */
  maxObjectTypes?: number;
  /** How many instances to return per object type. */
  maxInstancesPerType?: number;
  /** Re-rank hits with a cross-encoder; silently skipped if no rerank model is deployed. */
  rerank?: boolean;
  /** Ship the trimmed definitions of the object types that produced hits (default true). */
  includeObjectTypes?: boolean;
  /**
   * A `bkn_context` the caller built itself, sent as-is.
   *
   * The same escape hatch `context.toolCall` has: supplying one skips the
   * managed session entirely, so an `operation_key` pre-registered through
   * `ManagedTrace` survives instead of being replaced, and
   * `parent_operation_id` / `causation_event_ids` travel with it.
   */
  bknContext?: BknContext;
}

function searchBody(knId: string, query: string, opts: SearchInstanceOptions) {
  return {
    kn_id: knId,
    query,
    ...(opts.conceptGroups?.length ? { concept_groups: opts.conceptGroups } : {}),
    ...(opts.objectTypes?.length ? { object_types: opts.objectTypes } : {}),
    ...(opts.excludeObjectTypes?.length ? { exclude_object_types: opts.excludeObjectTypes } : {}),
    ...(opts.maxObjectTypes === undefined ? {} : { max_object_types: opts.maxObjectTypes }),
    ...(opts.maxInstancesPerType === undefined
      ? {}
      : { max_instances_per_type: opts.maxInstancesPerType }),
    ...(opts.rerank === undefined ? {} : { rerank: opts.rerank }),
    ...(opts.includeObjectTypes === undefined
      ? {}
      : { include_object_types: opts.includeObjectTypes }),
  };
}

/**
 * Recall instances from one natural-language sentence: concept recall picks the
 * object types, then each one is searched semantically (vector + full text,
 * fused by rank). Hits carry the trimmed object-type definitions needed to read
 * them, so a caller does not have to fetch schema separately.
 *
 * Only properties whose `condition_operations` include `match` or `knn` take
 * part, so an object type with no index produces no instances. No hits is not
 * an error: `nodes` comes back empty with a `message`.
 *
 * Deploys that enforce the lifecycle contract need a `bkn_context` in the body;
 * {@link withManagedLifecycle} opens the session that supplies one, and deploys
 * without the contract get the request unchanged.
 */
export function searchInstance(
  ctx: RequestContext,
  knId: string,
  query: string,
  opts: SearchInstanceOptions = {},
): Promise<unknown> {
  if (opts.bknContext) {
    return request(ctx, `${RETRIEVAL_BASE}/search_instance`, {
      method: "POST",
      body: { ...searchBody(knId, query, opts), bkn_context: opts.bknContext },
    });
  }
  return withManagedLifecycle(ctx, knId, query, (bknContext) =>
    request(ctx, `${RETRIEVAL_BASE}/search_instance`, {
      method: "POST",
      body: {
        ...searchBody(knId, query, opts),
        ...(bknContext ? { bkn_context: bknContext } : {}),
      },
    }),
  );
}
