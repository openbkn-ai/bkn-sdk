/**
 * Knowledge-network backend client (ontology-manager + agent-retrieval).
 * Endpoints mirror kweaver-sdk; responses are passed through as parsed JSON
 * (shapes vary by backend version — validate at higher layers as needed).
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const ONTOLOGY_BASE = "/api/ontology-manager/v1/knowledge-networks";
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
