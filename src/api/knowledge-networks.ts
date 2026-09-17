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
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import {
  type BranchOptions,
  type ImportWriteOptions,
  type StrictWriteOptions,
  idSegment,
  writeQuery,
} from "./bkn-backend.js";
import { request } from "./http.js";
import {
  type BknContext,
  requestContextForBusinessContext,
  toWireBknContext,
  withManagedLifecycle,
} from "./lifecycle.js";

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
  branch?: string;
  /** `full` (default) returns complete definitions; `summary` only concept ids and names. */
  detailLevel?: "full" | "summary";
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
      branch: opts.branch || undefined,
      detail_level: opts.detailLevel || undefined,
    },
  });
}

/** Query flags of a knowledge-network create. */
export interface CreateKnQueryOptions extends ImportWriteOptions {
  /** `preserve` (backend default) keeps environment-local bindings; `detach` drops them. */
  bindingPolicy?: "preserve" | "detach";
}

export interface CreateKnOptions extends CreateKnQueryOptions {
  name: string;
  /** Network id; immutable after creation. The backend mints one when omitted. */
  id?: string;
  tags?: string[];
  comment?: string;
  icon?: string;
  color?: string;
  /** @deprecated Not part of the create contract; ignored. */
  baseBranch?: string;
}

function createKnQuery(opts: CreateKnQueryOptions, branch: string | undefined) {
  return {
    ...writeQuery({ ...opts, branch }),
    binding_policy: opts.bindingPolicy || undefined,
  };
}

/**
 * Create a knowledge network from a fully-formed body (e.g. a rendered template).
 * The query `branch` defaults to the body's own, so the two never disagree.
 */
export function createKnowledgeNetworkRaw(
  ctx: RequestContext,
  body: unknown,
  opts: CreateKnQueryOptions = {},
): Promise<unknown> {
  const declared = (body as { branch?: unknown } | null)?.branch;
  const bodyBranch = typeof declared === "string" ? declared : undefined;
  return request(ctx, ONTOLOGY_BASE, {
    method: "POST",
    query: createKnQuery(opts, opts.branch || bodyBranch),
    body,
  });
}

export function createKnowledgeNetwork(
  ctx: RequestContext,
  opts: CreateKnOptions,
): Promise<unknown> {
  // The backend reads the branch from the query (default main) as well as the body;
  // send the same one in both, or `--branch dev` creates on main.
  const branch = opts.branch || "main";
  return request(ctx, ONTOLOGY_BASE, {
    method: "POST",
    query: createKnQuery(opts, branch),
    body: {
      ...(opts.id ? { id: opts.id } : {}),
      name: opts.name,
      ...(opts.tags ? { tags: opts.tags } : {}),
      ...(opts.comment !== undefined ? { comment: opts.comment } : {}),
      ...(opts.icon !== undefined ? { icon: opts.icon } : {}),
      ...(opts.color !== undefined ? { color: opts.color } : {}),
      branch,
    },
  });
}

export function deleteKnowledgeNetwork(
  ctx: RequestContext,
  knId: string,
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}`, {
    method: "DELETE",
    query: { branch: opts.branch || undefined },
  });
}

export function updateKnowledgeNetwork(
  ctx: RequestContext,
  knId: string,
  body: unknown,
  opts: ImportWriteOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}`, {
    method: "PUT",
    query: writeQuery(opts),
    body,
  });
}

/**
 * Reads that carry a JSON query body. The backend models them as GETs tunnelled
 * over POST and rejects the request outright without the override header
 * (`NullParameter.OverrideMethod`).
 */
const QUERY_OVER_POST = { "X-HTTP-Method-Override": "GET" } as const;

/**
 * Creates on the schema collection routes. The same POST also serves a search, so the
 * backend picks the body schema from the override header, which it requires.
 */
const CREATE_OVER_POST = { "X-HTTP-Method-Override": "POST" } as const;

/** A comma-joined string or a list, as a list without blanks. */
function csvList(value: string | Array<string | number> | undefined): string[] {
  const list = typeof value === "string" ? value.split(",") : (value ?? []).map(String);
  return list.map((v) => v.trim()).filter(Boolean);
}

/**
 * A deep-paging cursor as the backend reads it: one comma-joined string of the
 * previous page's sort values, in order. Positional, so a component is kept
 * verbatim — an empty one (a sort field whose value was empty) still holds its
 * slot; dropping it would shift the tuple. Only a wholly blank cursor is omitted.
 */
function searchAfterParam(value: string | Array<string | number> | undefined): string | undefined {
  if (value === undefined) return undefined;
  const joined = typeof value === "string" ? value : value.map(String).join(",");
  return joined.trim() ? joined : undefined;
}

/** System fields an ontology-query read can leave out of each instance. */
export type SystemProperty = "_instance_id" | "_instance_identity" | "_display";

/** Query-string flags shared by the ontology-query instance reads. */
export interface InstanceReadOptions {
  branch?: string;
  /** Include the computation parameters of logic properties. */
  includeLogicParams?: boolean;
  /** Drop these system fields from each returned instance. */
  excludeSystemProperties?: SystemProperty[];
  /** Skip the index and read the store directly. */
  ignoringStoreCache?: boolean;
}

function instanceReadQuery(opts: InstanceReadOptions & { includeTypeInfo?: boolean }) {
  return {
    branch: opts.branch || undefined,
    include_type_info: opts.includeTypeInfo ? "true" : undefined,
    include_logic_params: opts.includeLogicParams ? "true" : undefined,
    exclude_system_properties: opts.excludeSystemProperties?.length
      ? opts.excludeSystemProperties
      : undefined,
    ignoring_store_cache: opts.ignoringStoreCache ? "true" : undefined,
  };
}

export interface SubgraphQueryOptions extends InstanceReadOptions {
  /** `""` (default) explores from a start point; `relation_path` follows given paths. */
  queryType?: "" | "relation_path";
}

/** Query a subgraph (ontology-query). Body is a JSON query passthrough. */
export function querySubgraph(
  ctx: RequestContext,
  knId: string,
  body: unknown,
  opts: SubgraphQueryOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/subgraph`, {
    method: "POST",
    headers: QUERY_OVER_POST,
    query: { query_type: opts.queryType || undefined, ...instanceReadQuery(opts) },
    body,
    responseParser: parseBigIntJSON,
  });
}

export interface ActionLogListOptions {
  actionTypeId?: string;
  /** `pending` | `running` | `completed` | `failed` | `cancelled`. */
  status?: string;
  /** `manual` | `scheduled`. */
  triggerType?: string;
  /** Case-insensitive literal substring of the execution id. */
  keyword?: string;
  /** Start-time range, epoch milliseconds. */
  startTimeFrom?: number;
  startTimeTo?: number;
  limit?: number;
  /** Ignored by the backend once `searchAfter` is set. */
  offset?: number;
  needTotal?: boolean;
  /** Deep-paging cursor from the previous page; a list is comma-joined. */
  searchAfter?: string | Array<string | number>;
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
      keyword: opts.keyword || undefined,
      start_time_from: opts.startTimeFrom,
      start_time_to: opts.startTimeTo,
      limit: opts.limit ?? 30,
      offset: opts.offset,
      need_total: opts.needTotal ? "true" : undefined,
      search_after: searchAfterParam(opts.searchAfter),
    },
    responseParser: parseBigIntJSON,
  });
}

export interface ActionLogGetOptions {
  /** Page size of the embedded `results` (backend default 100, max 1000). */
  resultsLimit?: number;
  /** `resultsOffset + resultsLimit` must not exceed 10000. */
  resultsOffset?: number;
  /** `success` | `failed`. */
  resultsStatus?: string;
}

export function getActionLog(
  ctx: RequestContext,
  knId: string,
  logId: string,
  opts: ActionLogGetOptions = {},
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/action-logs/${encodeURIComponent(logId)}`,
    {
      query: {
        results_limit: opts.resultsLimit,
        results_offset: opts.resultsOffset,
        results_status: opts.resultsStatus || undefined,
      },
      responseParser: parseBigIntJSON,
    },
  );
}

export function cancelActionLog(
  ctx: RequestContext,
  knId: string,
  logId: string,
  opts: { reason?: string } = {},
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/action-logs/${encodeURIComponent(logId)}/cancel`,
    { method: "POST", body: opts.reason ? { reason: opts.reason } : undefined },
  );
}

export interface ObjectQueryOptions extends InstanceReadOptions {
  /** Include the object type definition in the response. */
  includeTypeInfo?: boolean;
}

/**
 * Query instances of an object type (ontology-query). Body is a JSON query passthrough:
 * `{limit, condition?, sort?, need_total?, properties?}`. Paging depends on the deploy:
 * with foundry #1623 the response carries `paging.next_cursor`, sent back as `cursor`
 * for the next page; older deploys return no `paging` and page with body `offset`.
 */
export function queryObjectTypeInstances(
  ctx: RequestContext,
  knId: string,
  otId: string,
  body: unknown,
  opts: ObjectQueryOptions = {},
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/object-types/${encodeURIComponent(otId)}`,
    {
      method: "POST",
      headers: QUERY_OVER_POST,
      query: instanceReadQuery(opts),
      body,
      responseParser: parseBigIntJSON,
    },
  );
}

export interface ActionTypeQueryOptions {
  branch?: string;
  /** Include the action type definition in the response. */
  includeTypeInfo?: boolean;
  excludeSystemProperties?: SystemProperty[];
}

/**
 * Query an action type (ontology-query): a read tunnelled over POST, so it carries
 * the GET override. Body is a JSON query passthrough.
 */
export function queryActionType(
  ctx: RequestContext,
  knId: string,
  atId: string,
  body: unknown,
  opts: ActionTypeQueryOptions = {},
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/action-types/${encodeURIComponent(atId)}`,
    {
      method: "POST",
      headers: QUERY_OVER_POST,
      query: instanceReadQuery(opts),
      body,
      responseParser: parseBigIntJSON,
    },
  );
}

/** Execute an action type (ontology-query). Body is the execution envelope. */
export function executeActionType(
  ctx: RequestContext,
  knId: string,
  atId: string,
  body: unknown,
  opts: { branch?: string } = {},
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/action-types/${encodeURIComponent(atId)}/execute`,
    {
      method: "POST",
      query: { branch: opts.branch || undefined },
      body,
      responseParser: parseBigIntJSON,
    },
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

/** Query-string flags of the metric data reads. */
export interface MetricReadOptions {
  branch?: string;
  /** Align trend series to the full bucket axis, filling gaps with null. */
  fillNull?: boolean;
}

function metricReadQuery(opts: MetricReadOptions) {
  return { branch: opts.branch || undefined, fill_null: opts.fillNull ? "true" : undefined };
}

/** Query a metric's data (ontology-query). Body is a JSON query passthrough. */
export function queryMetricData(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  body: unknown,
  opts: MetricReadOptions = {},
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/metrics/${encodeURIComponent(metricId)}/data`,
    { method: "POST", query: metricReadQuery(opts), body, responseParser: parseBigIntJSON },
  );
}

/** Dry-run a metric definition (ontology-query). */
export function dryRunMetric(
  ctx: RequestContext,
  knId: string,
  body: unknown,
  opts: MetricReadOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/metrics/dry-run`, {
    method: "POST",
    query: metricReadQuery(opts),
    body,
    responseParser: parseBigIntJSON,
  });
}

/** Filters every bkn-backend schema list takes. */
export interface ListSchemaOptions {
  branch?: string;
  /** -1 = all (the SDK default; the backend's own default is 10). */
  limit?: number;
  offset?: number;
  /** Fuzzy name match. */
  namePattern?: string;
  /** Exact tag match. */
  tag?: string;
  /** `update_time` | `name`. */
  sort?: string;
  direction?: "asc" | "desc";
}

export interface ListObjectTypesOptions extends ListSchemaOptions {
  /** Return total_count (backend default true). */
  needTotal?: boolean;
  /** Deep-paging cursor; a list is comma-joined. Offset is ignored once set. */
  searchAfter?: string | Array<string | number>;
}

export interface ListRelationTypesOptions extends ListSchemaOptions {
  sourceObjectTypeId?: string;
  targetObjectTypeId?: string;
  /** Relation types whose source or target is one of these object types. */
  boundObjectTypeId?: string | string[];
}

export interface ListActionTypesOptions extends ListSchemaOptions {
  /** Action category: `add` | `modify` | `delete`. */
  actionType?: string;
  /** Bound object type. */
  objectTypeId?: string;
}

export interface ListMetricsOptions extends ListSchemaOptions {
  /** `object_type` | `subgraph`. */
  scopeType?: string;
  /** Concept id(s) the metric scope references, comma-joined. */
  scopeRef?: string;
}

function schemaListQuery(opts: ListSchemaOptions) {
  return {
    branch: opts.branch ?? "main",
    limit: String(opts.limit ?? -1),
    offset: opts.offset,
    name_pattern: opts.namePattern || undefined,
    tag: opts.tag || undefined,
    sort: opts.sort || undefined,
    direction: opts.direction || undefined,
  };
}

export function listObjectTypes(
  ctx: RequestContext,
  knId: string,
  opts: ListObjectTypesOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/object-types`, {
    query: {
      ...schemaListQuery(opts),
      need_total: opts.needTotal === undefined ? undefined : String(opts.needTotal),
      search_after: searchAfterParam(opts.searchAfter),
    },
  });
}

/** Batch-create object types in one all-or-nothing transaction (`{entries:[…]}`). */
export function createObjectTypes(
  ctx: RequestContext,
  knId: string,
  entries: unknown[],
  branch = "main",
  opts: Omit<ImportWriteOptions, "branch"> = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/object-types`, {
    method: "POST",
    headers: CREATE_OVER_POST,
    query: writeQuery({ ...opts, branch }),
    body: { entries },
  });
}

export function listRelationTypes(
  ctx: RequestContext,
  knId: string,
  opts: ListRelationTypesOptions = {},
): Promise<unknown> {
  const bound = csvList(opts.boundObjectTypeId);
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/relation-types`, {
    query: {
      ...schemaListQuery(opts),
      source_object_type_id: opts.sourceObjectTypeId || undefined,
      target_object_type_id: opts.targetObjectTypeId || undefined,
      bound_object_type_id: bound.length ? bound : undefined,
    },
  });
}

export function listActionTypes(
  ctx: RequestContext,
  knId: string,
  opts: ListActionTypesOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/action-types`, {
    query: {
      ...schemaListQuery(opts),
      action_type: opts.actionType || undefined,
      object_type_id: opts.objectTypeId || undefined,
    },
  });
}

/** Schema item kind in the bkn-backend schema path. */
export type SchemaKind = "object-types" | "relation-types" | "action-types";

/**
 * A create body is `{entries:[…]}`; a bare array is wrapped into that envelope,
 * anything else is sent as given.
 */
function entriesBody(body: unknown): unknown {
  return Array.isArray(body) ? { entries: body } : body;
}

/**
 * Get one or more schema items. The route takes a list: ids may be comma-joined (or
 * a list), each encoded on its own with the commas kept literal.
 */
export function getSchemaItem(
  ctx: RequestContext,
  knId: string,
  kind: SchemaKind,
  id: string | string[],
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/${kind}/${idSegment(id)}`, {
    query: { branch: opts.branch || undefined },
  });
}
/** Create schema items: `{entries:[…]}` (a bare array is wrapped). */
export function createSchemaItem(
  ctx: RequestContext,
  knId: string,
  kind: SchemaKind,
  body: unknown,
  opts: ImportWriteOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/${kind}`, {
    method: "POST",
    headers: CREATE_OVER_POST,
    query: writeQuery(opts),
    body: entriesBody(body),
  });
}

export type UpdateSchemaItemOptions = StrictWriteOptions;

/** Update one schema item. The body carries `base_version`, the version it was read at. */
export function updateSchemaItem(
  ctx: RequestContext,
  knId: string,
  kind: SchemaKind,
  id: string,
  body: unknown,
  opts: UpdateSchemaItemOptions = {},
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/${kind}/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      query: {
        branch: opts.branch || undefined,
        strict_mode: opts.strictMode === undefined ? undefined : String(opts.strictMode),
      },
      body,
    },
  );
}

export interface DeleteSchemaItemOptions {
  branch?: string;
  /** Object types only: delete even when a relation type still binds it. */
  forceDelete?: boolean;
}

/** Delete one or more schema items (comma-joined ids or a list, as {@link getSchemaItem}). */
export function deleteSchemaItem(
  ctx: RequestContext,
  knId: string,
  kind: SchemaKind,
  id: string | string[],
  opts: DeleteSchemaItemOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/${kind}/${idSegment(id)}`, {
    method: "DELETE",
    query: {
      branch: opts.branch || undefined,
      force_delete: opts.forceDelete && kind === "object-types" ? "true" : undefined,
    },
  });
}

// Metric definitions live under bkn-backend (data/dry-run are query-side).
export function listMetrics(
  ctx: RequestContext,
  knId: string,
  opts: ListMetricsOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics`, {
    query: {
      ...schemaListQuery(opts),
      scope_type: opts.scopeType || undefined,
      scope_ref: opts.scopeRef || undefined,
    },
  });
}
/** Get one or more metrics (comma-joined ids or a list). */
export function getMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string | string[],
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics/${idSegment(metricId)}`,
    {
      query: { branch: opts.branch || undefined },
    },
  );
}
/** Create metrics: `{entries:[…]}` (a bare array is wrapped). */
export function createMetric(
  ctx: RequestContext,
  knId: string,
  body: unknown,
  opts: ImportWriteOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics`, {
    method: "POST",
    headers: CREATE_OVER_POST,
    query: writeQuery(opts),
    body: entriesBody(body),
  });
}
export function updateMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  body: unknown,
  opts: StrictWriteOptions = {},
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics/${encodeURIComponent(metricId)}`,
    {
      method: "PUT",
      query: writeQuery({ branch: opts.branch, strictMode: opts.strictMode }),
      body,
    },
  );
}
/** Delete one or more metrics (comma-joined ids or a list). */
export function deleteMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string | string[],
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics/${idSegment(metricId)}`,
    {
      method: "DELETE",
      query: { branch: opts.branch || undefined },
    },
  );
}
export function validateMetric(
  ctx: RequestContext,
  knId: string,
  body: unknown,
  opts: ImportWriteOptions = {},
): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_BASE}/${encodeURIComponent(knId)}/metrics/validation`, {
    method: "POST",
    query: writeQuery(opts),
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
  /** Positive whole count of object types that may take part. Each costs a downstream query. */
  maxObjectTypes?: number;
  /** Positive whole count of instances to return per object type. */
  maxInstancesPerType?: number;
  /** Re-rank hits with a cross-encoder; silently skipped if no rerank model is deployed. */
  rerank?: boolean;
  /** Ship the trimmed definitions of the object types that produced hits (default true). */
  includeObjectTypes?: boolean;
  /**
   * A `bkn_context` the caller built itself.
   *
   * The same escape hatch `context.toolCall` has: supplying one skips the
   * managed session entirely, and `parent_operation_id` / `causation_event_ids`
   * / `business_refs` travel with it. Fields `BKNContext` does not accept —
   * notably an `operation_key` minted by `ManagedTrace` — are dropped before
   * sending: the contract forbids callers to submit it.
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
export async function searchInstance(
  ctx: RequestContext,
  knId: string,
  query: string,
  opts: SearchInstanceOptions = {},
): Promise<unknown> {
  validateSearchBudget(opts);
  if (opts.bknContext) {
    const bknContext = toWireBknContext(opts.bknContext);
    return request(
      requestContextForBusinessContext(ctx, bknContext),
      `${RETRIEVAL_BASE}/search_instance`,
      {
        method: "POST",
        body: { ...searchBody(knId, query, opts), bkn_context: bknContext },
      },
    );
  }
  return withManagedLifecycle(ctx, knId, query, (bknContext, requestContext) =>
    request(requestContext, `${RETRIEVAL_BASE}/search_instance`, {
      method: "POST",
      body: {
        ...searchBody(knId, query, opts),
        ...(bknContext ? { bkn_context: bknContext } : {}),
      },
    }),
  );
}

function validateSearchBudget(opts: SearchInstanceOptions): void {
  assertPositiveWholeNumber(opts.maxObjectTypes, "maxObjectTypes");
  assertPositiveWholeNumber(opts.maxInstancesPerType, "maxInstancesPerType");
}

function assertPositiveWholeNumber(value: number | undefined, name: string): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InputError(`${name} must be a positive integer.`);
  }
}
