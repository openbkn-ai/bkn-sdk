/**
 * Knowledge-network backend client (ontology-manager + agent-retrieval).
 * Endpoints mirror kweaver-sdk; responses are passed through as parsed JSON
 * (shapes vary by backend version — validate at higher layers as needed).
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const ONTOLOGY_BASE = "/api/ontology-manager/v1/knowledge-networks";
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

/** Query a subgraph (ontology-query). Body is a JSON query passthrough. */
export function querySubgraph(ctx: RequestContext, knId: string, body: unknown): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/subgraph`, {
    method: "POST",
    body,
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
  });
}

export function getActionLog(ctx: RequestContext, knId: string, logId: string): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/action-logs/${encodeURIComponent(logId)}`,
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
    { method: "POST", body },
  );
}

/** Get an object type's (calculated) properties (ontology-query). */
export function getObjectTypeProperties(
  ctx: RequestContext,
  knId: string,
  otId: string,
): Promise<unknown> {
  return request(
    ctx,
    `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/object-types/${encodeURIComponent(otId)}/properties`,
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
    { method: "POST", body },
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
    { method: "POST", body },
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
    { method: "POST", body },
  );
}

/** Dry-run a metric definition (ontology-query). */
export function dryRunMetric(ctx: RequestContext, knId: string, body: unknown): Promise<unknown> {
  return request(ctx, `${ONTOLOGY_QUERY_BASE}/${encodeURIComponent(knId)}/metrics/dry-run`, {
    method: "POST",
    body,
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

/** Schema item kind in the ontology-manager path. */
export type SchemaKind = "object-types" | "relation-types";

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

export interface SemanticSearchOptions {
  mode?: string;
  maxConcepts?: number;
  returnQueryUnderstanding?: boolean;
}

export function semanticSearch(
  ctx: RequestContext,
  knId: string,
  query: string,
  opts: SemanticSearchOptions = {},
): Promise<unknown> {
  return request(ctx, `${RETRIEVAL_BASE}/semantic-search`, {
    method: "POST",
    body: {
      kn_id: knId,
      query,
      mode: opts.mode ?? "keyword_vector_retrieval",
      max_concepts: opts.maxConcepts ?? 10,
      return_query_understanding: opts.returnQueryUnderstanding ?? false,
    },
  });
}
