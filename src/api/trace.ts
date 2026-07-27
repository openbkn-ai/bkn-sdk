// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * BKN Trace client (agent-observability). Implements raw trace search and a
 * two-hop "spans by conversation" fetch. The full
 * diagnose/eval-set rule engine (LLM-as-judge) is a separate large feature and
 * is NOT included here — see docs/exec-plans/tech-debt-tracker.md.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const SEARCH = "/api/agent-observability/v1/traces/_search";
const EVIDENCE_EVENTS = "/api/agent-observability/v1/evidence/events";
const EVIDENCE_ARTIFACTS = "/api/agent-observability/v1/evidence/artifacts";
const REQUESTS = "/api/agent-observability/v1/requests";
const INTERACTIONS = "/api/agent-observability/v1/interactions";
const TRACES = "/api/agent-observability/v1/traces";

interface SearchHits {
  hits?: { hits?: Array<{ _source?: Record<string, unknown> }> };
  aggregations?: { tids?: { buckets?: Array<{ key?: string }> } };
}

/** A span flattened to the fields the diagnose rules read. */
export interface RawSpan {
  spanId: string;
  parentSpanId: string | null;
  name?: string;
  traceId?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  status?: { code?: string };
  attributes?: Record<string, unknown>;
  events?: Array<{ name?: string; time?: string; attributes?: Record<string, unknown> }>;
}

export interface EvidenceTraceContext {
  trace_id: string;
  traceparent: string;
  "bkn.request.id": string;
  "bkn.conversation.id"?: string;
  "bkn.tenant.id"?: string;
  business_domain?: string;
  "bkn.account.id": string;
  "bkn.account.type": string;
}

export type BusinessEvidenceEventType =
  | "agent.interaction.started"
  | "retrieval.completed"
  | "knowledge.read.observed"
  | "data.query.observed"
  | "logic.execution.observed"
  | "model.call.observed"
  | "tool.called"
  | "tool.result.observed"
  | "claim.created"
  | "evidence.refs.created"
  | "business.refs.resolved"
  | "action.recommended"
  | "action.approval_requested"
  | "action.approved"
  | "action.rejected"
  | "action.executed"
  | "action.result_recorded";

export interface EvidenceEvent {
  event_id: string;
  event_type: BusinessEvidenceEventType | (string & {});
  "bkn.trace.schema.version": string;
  observed_at: string;
  emitted_at: string;
  producer_module: string;
  trace_id: string;
  span_id: string;
  "bkn.request.id": string;
  "bkn.operation.name": string;
  interaction_id?: string;
  operation_id?: string;
  causation_event_id?: string;
  claim_id?: string;
  attempt?: number;
  payload: Record<string, unknown>;
}

export interface EvidenceIngestRequest {
  "bkn.trace.schema.version": "2.0.0" | "2.1.0" | "2.2.0";
  trace: EvidenceTraceContext;
  events: EvidenceEvent[];
}

export type EvidenceArtifactType =
  | "action_input"
  | "action_result"
  | "data_result"
  | "logic_execution"
  | "query"
  | "question"
  | "result";

export interface EvidenceArtifact {
  artifact_id: string;
  artifact_type: EvidenceArtifactType;
  "bkn.request.id": string;
  trace_id?: string;
  interaction_id?: string;
  operation_id?: string;
  claim_id?: string;
  source_ref?: string;
  business_refs?: string[];
  content_type: string;
  schema_version: "2.2.0";
  observed_at: string;
  as_of?: string;
  source_version?: string;
  content_hash: string;
  content?: unknown;
  snapshot_ref?: string;
  "bkn.tenant.id"?: string;
  business_domain?: string;
  "bkn.account.id": string;
  "bkn.account.type": string;
  initiator?: string;
  agent_or_app?: string;
}

export interface EvidenceArtifactIngestResponse {
  artifact_id: string;
  artifact_type: EvidenceArtifactType;
  "bkn.request.id": string;
  trace_id?: string;
  content_hash: string;
  created: boolean;
}

export interface ActionSummary {
  recommended: number;
  approved: number;
  executed: number;
  completed: number;
  last_status?: string;
}

export interface RequestSummary {
  request_id: string;
  conversation_id?: string;
  interaction_id?: string;
  started_at?: string;
  completed_at?: string;
  initiator?: string;
  agent_or_app?: string;
  business_domain?: string;
  knowledge_networks?: string[];
  question_preview?: string;
  result_preview?: string;
  status: string;
  evidence_completeness: string;
  partial_reasons?: string[];
  business_refs?: string[];
  action_summary: Partial<ActionSummary>;
  trace_count: number;
  duration_ms?: number;
  error_summary?: string;
}

export interface TraceExecutionSummary {
  trace_id: string;
  request_id: string;
  conversation_id?: string;
  interaction_id?: string;
  started_at?: string;
  completed_at?: string;
  agent_or_app?: string;
  business_domain?: string;
  root_operation?: string;
  status: string;
  span_count: number;
  duration_ms?: number;
  error_summary?: string;
}

export interface SummaryPage<T> {
  entries: T[];
  total: number;
  next_cursor?: string | null;
  truncated: boolean;
  partial: boolean;
  partial_reasons?: string[];
}

export interface RequestSummaryQuery {
  limit?: number;
  cursor?: string;
  from?: string;
  to?: string;
  status?: string;
  agentOrApp?: string;
  businessDomain?: string;
  conversationId?: string;
  interactionId?: string;
  knowledgeNetwork?: string;
  evidenceCompleteness?: string;
  keyword?: string;
}

export interface InteractionSummary {
  interaction_id: string;
  conversation_id?: string;
  started_at?: string;
  completed_at?: string;
  status: string;
  duration_ms?: number;
  requests: RequestSummary[];
  traces: TraceExecutionSummary[];
}

export interface EvidenceIngestResponse {
  trace_id: string;
  "bkn.request.id": string;
  "bkn.trace.schema.version": string;
  accepted_event_count: number;
  claim_count: number;
  evidence_ref_count: number;
  business_ref_count: number;
}

export interface VisibilitySummary {
  authorized_ref_count: number;
  redacted_ref_count: number;
  hidden_ref_count: number;
  omitted_ref_count: number;
  unresolved_ref_count: number;
  unauthorized_ref_count?: number;
}

export interface GraphPage {
  node_count: number;
  edge_count: number;
  truncated?: boolean;
  next_cursor?: string | null;
}

export interface TraceGraphNode {
  span_id: string;
  parent_span_id?: string;
  name: string;
  kind: string;
  service_name?: string;
  status: string;
  error_message?: string;
  start_nano: number;
  end_nano: number;
  duration_nano: number;
}

export interface TraceGraphEdge {
  id: string;
  parent_span_id: string;
  child_span_id: string;
  edge_type: string;
}

export interface TraceGraphResponse {
  trace_id: string;
  status: string;
  duration_nano: number;
  partial: boolean;
  partial_reason: string[];
  page: GraphPage;
  data: {
    nodes: TraceGraphNode[];
    edges: TraceGraphEdge[];
  };
}

export interface EvidenceChainResponse {
  trace_id: string;
  "bkn.request.id": string;
  partial: boolean;
  partial_reason: string[];
  visibility_summary: VisibilitySummary;
  page: GraphPage;
  data: {
    claims: Array<Record<string, unknown>>;
    evidence_refs: Array<Record<string, unknown>>;
    business_refs: Array<Record<string, unknown>>;
  };
}

export interface BusinessGraphResponse {
  trace_id: string;
  "bkn.request.id": string;
  partial: boolean;
  partial_reason: string[];
  visibility_summary: VisibilitySummary;
  page: GraphPage;
  data: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
}

export interface SnapshotPreviewResponse {
  trace_id: string;
  "bkn.request.id": string;
  partial: boolean;
  partial_reason: string[];
  visibility_summary: VisibilitySummary;
  snapshot_ref: {
    snapshot_id: string;
    mode: "preview" | string;
    uri?: string;
  };
  manifest: Record<string, unknown>;
}

export type TraceScope = string | { traceId: string } | { requestId: string };
export interface TraceQueryOptions {
  limit?: number;
}

function isoToNanos(iso: string): string | undefined {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return undefined;
  return (BigInt(ms) * 1_000_000n).toString();
}

function normalizeRawSpan(src: Record<string, unknown>): RawSpan | null {
  const spanIdRaw = src.spanId ?? src.span_id;
  const spanId = typeof spanIdRaw === "string" ? spanIdRaw : "";
  if (!spanId) return null;
  const parentRaw = src.parentSpanId ?? src.parent_span_id;
  const parentSpanId =
    typeof parentRaw === "string" && parentRaw !== "" && parentRaw !== "0" ? parentRaw : null;
  const start =
    typeof src.startTimeUnixNano === "string"
      ? src.startTimeUnixNano
      : typeof src.startTime === "string"
        ? isoToNanos(src.startTime)
        : undefined;
  const end =
    typeof src.endTimeUnixNano === "string"
      ? src.endTimeUnixNano
      : typeof src.endTime === "string"
        ? isoToNanos(src.endTime)
        : undefined;
  const traceIdRaw = src.traceId ?? src.trace_id;
  return {
    spanId,
    parentSpanId,
    name: typeof src.name === "string" ? src.name : undefined,
    traceId: typeof traceIdRaw === "string" ? traceIdRaw : undefined,
    startTimeUnixNano: start,
    endTimeUnixNano: end,
    status: src.status as RawSpan["status"] | undefined,
    attributes: src.attributes as Record<string, unknown> | undefined,
    events: Array.isArray(src.events) ? (src.events as RawSpan["events"]) : undefined,
  };
}

/** Two-hop fetch of a conversation's spans, normalized to `RawSpan` + observed traceIds. */
export async function getRawSpansByConversation(
  ctx: RequestContext,
  conversationId: string,
  opts: { maxTraceIds?: number; maxSpans?: number } = {},
): Promise<{ spans: RawSpan[]; traceIds: string[] }> {
  const sources = await getSpansByConversation(ctx, conversationId, opts);
  const spans: RawSpan[] = [];
  const traceIds = new Set<string>();
  for (const src of sources) {
    const span = normalizeRawSpan(src);
    if (!span) continue;
    spans.push(span);
    if (span.traceId) traceIds.add(span.traceId);
  }
  return { spans, traceIds: [...traceIds] };
}

/** Raw OpenSearch-style trace search (body passthrough). */
export function traceSearch(ctx: RequestContext, body: unknown): Promise<unknown> {
  return request(ctx, SEARCH, { method: "POST", body });
}

/** Submit BKN Trace phase-two claim/evidence/business events. */
export function emitEvidenceEvents(
  ctx: RequestContext,
  body: EvidenceIngestRequest,
): Promise<EvidenceIngestResponse> {
  return request<EvidenceIngestResponse>(ctx, EVIDENCE_EVENTS, {
    method: "POST",
    body,
    headers: evidenceWriteHeaders(ctx),
  });
}

/** Store authorized BKN Trace 2.2 business content separately from core events. */
export function emitEvidenceArtifact(
  ctx: RequestContext,
  body: EvidenceArtifact,
): Promise<EvidenceArtifactIngestResponse> {
  return request<EvidenceArtifactIngestResponse>(ctx, EVIDENCE_ARTIFACTS, {
    method: "POST",
    body,
    headers: evidenceWriteHeaders(ctx),
  });
}

function evidenceWriteHeaders(ctx: RequestContext): Record<string, string> | undefined {
  return ctx.evidenceIngestToken
    ? { "x-bkn-trace-ingest-token": ctx.evidenceIngestToken }
    : undefined;
}

/** Read one authorized BKN Trace 2.2 artifact by opaque id. */
export function getEvidenceArtifact(
  ctx: RequestContext,
  artifactId: string,
): Promise<EvidenceArtifact> {
  return request<EvidenceArtifact>(ctx, `${EVIDENCE_ARTIFACTS}/${encodeURIComponent(artifactId)}`);
}

/** List product-facing business request summaries. */
export function listRequestSummaries(
  ctx: RequestContext,
  query: RequestSummaryQuery = {},
): Promise<SummaryPage<RequestSummary>> {
  return request<SummaryPage<RequestSummary>>(ctx, REQUESTS, {
    query: summaryQuery(query),
  });
}

export function getRequestSummary(ctx: RequestContext, requestId: string): Promise<RequestSummary> {
  return request<RequestSummary>(ctx, `${REQUESTS}/${encodeURIComponent(requestId)}`);
}

export function getInteractionSummary(
  ctx: RequestContext,
  interactionId: string,
): Promise<InteractionSummary> {
  return request<InteractionSummary>(ctx, `${INTERACTIONS}/${encodeURIComponent(interactionId)}`);
}

export function getRequestTraces(
  ctx: RequestContext,
  requestId: string,
  query: Pick<RequestSummaryQuery, "cursor" | "limit"> = {},
): Promise<SummaryPage<TraceExecutionSummary>> {
  return request<SummaryPage<TraceExecutionSummary>>(
    ctx,
    `${REQUESTS}/${encodeURIComponent(requestId)}/traces`,
    { query: summaryQuery(query) },
  );
}

export function getTraceGraph(ctx: RequestContext, traceId: string): Promise<TraceGraphResponse> {
  return request<TraceGraphResponse>(ctx, `${TRACES}/${encodeURIComponent(traceId)}/trace-graph`);
}

export function getEvidenceChain(
  ctx: RequestContext,
  scope: TraceScope,
  opts: TraceQueryOptions = {},
): Promise<EvidenceChainResponse> {
  const target = traceTarget(scope, "evidence-chain");
  return request<EvidenceChainResponse>(ctx, target.path, {
    query: queryWithLimit(target.query, opts),
  });
}

export function getBusinessGraph(
  ctx: RequestContext,
  scope: TraceScope,
  opts: TraceQueryOptions = {},
): Promise<BusinessGraphResponse> {
  const target = traceTarget(scope, "business-graph");
  return request<BusinessGraphResponse>(ctx, target.path, {
    query: queryWithLimit(target.query, opts),
  });
}

export function getSnapshotPreview(
  ctx: RequestContext,
  scope: TraceScope,
  opts: TraceQueryOptions = {},
): Promise<SnapshotPreviewResponse> {
  const target = traceTarget(scope, "snapshot-preview");
  return request<SnapshotPreviewResponse>(ctx, target.path, {
    query: queryWithLimit(target.query, opts),
  });
}

/**
 * Fetch all span `_source` docs for a conversation.
 * Hop 1: aggregate trace ids for the conversation. Hop 2: fetch their spans.
 * (If hop 1 already returns flat hits, that is used directly.)
 */
export async function getSpansByConversation(
  ctx: RequestContext,
  conversationId: string,
  opts: { maxTraceIds?: number; maxSpans?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const agg =
    (await request<SearchHits>(ctx, SEARCH, {
      method: "POST",
      body: {
        size: 0,
        query: { term: { "attributes.gen_ai.conversation.id.keyword": conversationId } },
        aggs: { tids: { terms: { field: "traceId.keyword", size: opts.maxTraceIds ?? 100 } } },
      },
    })) ?? {};

  const direct = agg.hits?.hits;
  if (!agg.aggregations && Array.isArray(direct)) {
    return direct.map((h) => h._source ?? {});
  }

  const traceIds = (agg.aggregations?.tids?.buckets ?? [])
    .map((b) => b.key)
    .filter((k): k is string => typeof k === "string" && k.length > 0);
  if (traceIds.length === 0) return [];

  const spans =
    (await request<SearchHits>(ctx, SEARCH, {
      method: "POST",
      body: {
        size: opts.maxSpans ?? 2000,
        query: { terms: { "traceId.keyword": traceIds } },
      },
    })) ?? {};
  return (spans.hits?.hits ?? []).map((h) => h._source ?? {});
}

function traceTarget(
  scope: TraceScope,
  subresource: "evidence-chain" | "business-graph" | "snapshot-preview",
): { path: string; query?: Record<string, string> } {
  if (typeof scope === "string") {
    return { path: `${TRACES}/${encodeURIComponent(scope)}/${subresource}` };
  }
  if ("traceId" in scope) {
    return { path: `${TRACES}/${encodeURIComponent(scope.traceId)}/${subresource}` };
  }
  const requestPath =
    subresource === "evidence-chain"
      ? `${TRACES}/by-request`
      : `${TRACES}/by-request/${subresource}`;
  return { path: requestPath, query: { request_id: scope.requestId } };
}

function queryWithLimit(
  query: Record<string, string> | undefined,
  opts: TraceQueryOptions,
): Record<string, string | number> | undefined {
  if (opts.limit === undefined || !Number.isFinite(opts.limit)) return query;
  return { ...(query ?? {}), limit: opts.limit };
}

function summaryQuery(query: RequestSummaryQuery): Record<string, string | number> | undefined {
  const result: Record<string, string | number> = {};
  if (query.limit !== undefined && Number.isFinite(query.limit)) result.limit = query.limit;
  if (query.cursor) result.cursor = query.cursor;
  if (query.from) result.from = query.from;
  if (query.to) result.to = query.to;
  if (query.status) result.status = query.status;
  if (query.agentOrApp) result.agent_or_app = query.agentOrApp;
  if (query.businessDomain) result.business_domain = query.businessDomain;
  if (query.conversationId) result.conversation_id = query.conversationId;
  if (query.interactionId) result.interaction_id = query.interactionId;
  if (query.knowledgeNetwork) result.knowledge_network = query.knowledgeNetwork;
  if (query.evidenceCompleteness) {
    result.evidence_completeness = query.evidenceCompleteness;
  }
  if (query.keyword) result.keyword = query.keyword;
  return Object.keys(result).length ? result : undefined;
}
