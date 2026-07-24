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
  "bkn.tenant.id"?: string;
  business_domain?: string;
  "bkn.account.id": string;
  "bkn.account.type": string;
}

export interface EvidenceEvent {
  event_id: string;
  event_type: string;
  "bkn.trace.schema.version": string;
  observed_at: string;
  emitted_at: string;
  producer_module: string;
  trace_id: string;
  span_id: string;
  "bkn.request.id": string;
  "bkn.operation.name": string;
  payload: Record<string, unknown>;
}

export interface EvidenceIngestRequest {
  "bkn.trace.schema.version": "2.0.0";
  trace: EvidenceTraceContext;
  events: EvidenceEvent[];
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
  return request<EvidenceIngestResponse>(ctx, EVIDENCE_EVENTS, { method: "POST", body });
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
  if (opts.limit === undefined) return query;
  return { ...(query ?? {}), limit: opts.limit };
}
