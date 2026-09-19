// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * BKN Trace client (agent-observability). Implements typed technical Trace
 * queries and conversation-scoped Span normalization for diagnose/eval-set.
 */
import type { RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON, stringifyBigIntJSON } from "../utils/json-bigint.js";
import { request } from "./http.js";
import type { OperationCallFact, OperationReceipt } from "./trace-lifecycle.js";

const TRACES = "/api/agent-observability/v1/traces";

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

export interface TraceExecutionSummary {
  trace_id: string;
  request_id: string;
  conversation_id?: string;
  interaction_id?: string;
  started_at?: string;
  completed_at?: string;
  agent_or_app?: string;
  agent_name?: string;
  application_principal_id?: string;
  effective_subject_id?: string;
  question_preview?: string;
  result_preview?: string;
  root_service?: string;
  root_operation?: string;
  status: string;
  span_count: number;
  span_count_status?: string;
  duration_ms?: number;
  error_summary?: string;
}

export interface SummaryPage<T> {
  entries: T[];
  total: number;
  page?: number;
  page_size?: number;
  next_cursor?: string | null;
  truncated: boolean;
  partial: boolean;
  partial_reasons?: string[];
}

/**
 * Filters for `GET /traces`. The foundry spec lists limit (1..200), cursor,
 * trace_id, conversation_id, interaction_id, from, to, status, agent_or_app and
 * keyword; the live service also honours `service`, `tool` and `error_keyword`
 * (not yet in the spec). `errorKeyword` is an error-text filter distinct from
 * the broader `keyword`.
 */
export interface TechnicalTraceQuery {
  limit?: number;
  cursor?: string;
  from?: string;
  to?: string;
  status?: string;
  /** Exact producing (root) service. Live, not yet in the foundry spec. */
  service?: string;
  /** Exact root tool. Live, not yet in the foundry spec. */
  tool?: string;
  /** Agent or application name. */
  agentOrApp?: string;
  traceId?: string;
  /** Trace, request, operation, or error keyword. */
  keyword?: string;
  /** Case-insensitive error text only. Live, not yet in the foundry spec. */
  errorKeyword?: string;
  conversationId?: string;
  interactionId?: string;
}

/**
 * The contract declares no required field on an operation: Span nodes can
 * appear without Operation facts, and a fact may arrive without its input.
 */
export interface TechnicalTraceOperation {
  fact?: Partial<OperationCallFact>;
  receipt?: OperationReceipt;
  state?: string;
  partial_reasons?: string[];
}

export interface TechnicalTraceDetail {
  summary?: TraceExecutionSummary;
  graph?: TraceGraphResponse;
  operations?: TechnicalTraceOperation[];
  partial?: boolean;
  partial_reasons?: string[];
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
  start_nano: number | string | bigint;
  end_nano: number | string | bigint;
  duration_nano: number | bigint;
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
  duration_nano: number | bigint;
  partial: boolean;
  partial_reason: string[];
  page: GraphPage;
  data: {
    nodes: TraceGraphNode[];
    edges: TraceGraphEdge[];
  };
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

/** List authorized technical traces through the stable typed contract. */
export function listTechnicalTraces(
  ctx: RequestContext,
  query: TechnicalTraceQuery = {},
): Promise<SummaryPage<TraceExecutionSummary>> {
  return request<SummaryPage<TraceExecutionSummary>>(ctx, TRACES, {
    query: technicalTraceQuery(query),
  });
}

/** Read one authorized technical trace with Span and Operation facts. */
export function getTechnicalTrace(
  ctx: RequestContext,
  traceId: string,
): Promise<TechnicalTraceDetail> {
  return request<TechnicalTraceDetail>(ctx, `${TRACES}/${encodeURIComponent(traceId)}`, {
    responseParser: parseBigIntJSON,
  });
}

export async function getTraceGraph(
  ctx: RequestContext,
  traceId: string,
): Promise<TraceGraphResponse> {
  const detail = await getTechnicalTrace(ctx, traceId);
  if (!detail.graph) throw new Error(`No Span graph found for trace: ${traceId}`);
  return detail.graph;
}

/** The spec bounds one `/traces` page to 1..200 entries. */
const TRACE_PAGE_MAX = 200;
/** Stop following cursors after this many pages, whatever the server says. */
const TRACE_PAGE_CAP = 50;

/**
 * Fetch normalized spans for a conversation through typed Trace list/detail APIs.
 * `maxTraceIds` is the number of traces read in total (default 100); the list
 * is paged at no more than 200 per page and `next_cursor` is followed until
 * that many traces are listed, the server stops returning a cursor, or the
 * page cap is reached.
 */
export async function getSpansByConversation(
  ctx: RequestContext,
  conversationId: string,
  opts: { maxTraceIds?: number; maxSpans?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const maxTraces = clampInt(opts.maxTraceIds ?? 100, 1, Number.MAX_SAFE_INTEGER);
  const traceIds = await listConversationTraceIds(ctx, conversationId, maxTraces);
  const spans: Array<Record<string, unknown>> = [];
  const maxSpans = opts.maxSpans ?? 2000;
  for (const traceId of traceIds) {
    if (spans.length >= maxSpans) break;
    spans.push(...normalizedDetailSpans(await getTechnicalTrace(ctx, traceId), traceId));
  }
  return spans.slice(0, maxSpans);
}

async function listConversationTraceIds(
  ctx: RequestContext,
  conversationId: string,
  maxTraces: number,
): Promise<string[]> {
  const ids: string[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < TRACE_PAGE_CAP && ids.length < maxTraces; page += 1) {
    const result = await listTechnicalTraces(ctx, {
      conversationId,
      limit: clampInt(maxTraces - ids.length, 1, TRACE_PAGE_MAX),
      ...(cursor ? { cursor } : {}),
    });
    for (const entry of result?.entries ?? []) {
      if (ids.length >= maxTraces) break;
      if (entry?.trace_id) ids.push(entry.trace_id);
    }
    const next = result?.next_cursor ?? undefined;
    // A page without a cursor is the last one, truncated or not; a repeated
    // cursor would loop forever.
    if (!next || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  }
  return ids;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

type OperationWithFact = TechnicalTraceOperation & { fact: Partial<OperationCallFact> };

function normalizedDetailSpans(
  detail: TechnicalTraceDetail,
  requestedTraceId?: string,
): Array<Record<string, unknown>> {
  // The contract declares no required field on a detail: guard every read.
  const detailTraceId = detail?.summary?.trace_id ?? detail?.graph?.trace_id ?? requestedTraceId;
  const operations = (detail?.operations ?? []).filter(
    (operation): operation is OperationWithFact => Boolean(operation?.fact),
  );
  const operationsBySpan = new Map<string, OperationWithFact[]>();
  for (const operation of operations) {
    const spanId = operation.fact.span_id;
    if (!spanId) continue;
    operationsBySpan.set(spanId, [...(operationsBySpan.get(spanId) ?? []), operation]);
  }
  const representedAttempts = new Set<string>();
  const graphSpans = (detail?.graph?.data?.nodes ?? []).map((node) => {
    const matchingOperations = operationsBySpan.get(node.span_id) ?? [];
    const operation = matchingOperations.length === 1 ? matchingOperations[0] : undefined;
    if (operation) representedAttempts.add(operationAttemptKey(operation));
    return compactRecord({
      traceId: detailTraceId,
      spanId: node.span_id,
      parentSpanId: node.parent_span_id ?? "",
      name: node.name,
      kind: node.kind,
      startTimeUnixNano: safeNanoString(node.start_nano),
      endTimeUnixNano: safeNanoString(node.end_nano),
      status: { code: node.status === "error" ? "ERROR" : "OK" },
      attributes: {
        "service.name": node.service_name ?? "",
        ...(operation ? operationAttributes(operation) : {}),
      },
    });
  });
  const operationSpans = operations
    .filter((operation) => !representedAttempts.has(operationAttemptKey(operation)))
    .map((operation) =>
      compactRecord({
        traceId: operation.fact.trace_id ?? detailTraceId,
        spanId: operationAttemptKey(operation),
        parentSpanId: "",
        name: operation.fact.tool_name,
        kind: "CLIENT",
        startTimeUnixNano: operation.fact.started_at
          ? isoToNanos(operation.fact.started_at)
          : undefined,
        endTimeUnixNano: operation.fact.finished_at
          ? isoToNanos(operation.fact.finished_at)
          : undefined,
        status: {
          code: operation.fact.status === "failed" ? "ERROR" : "OK",
        },
        attributes: operationAttributes(operation),
      }),
    );
  return [...graphSpans, ...operationSpans];
}

function operationAttemptKey(operation: OperationWithFact): string {
  return `${operation.fact.operation_id}:attempt:${operation.fact.attempt}`;
}

function operationAttributes(operation: OperationWithFact): Record<string, unknown> {
  const input = operation.fact.input?.mode === "inline" ? operation.fact.input.inline : undefined;
  const error = operation.fact.error;
  const errorValue = error?.mode === "inline" ? error.inline : undefined;
  return compactRecord({
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": operation.fact.tool_name,
    "gen_ai.tool.args": input,
    "error.message": errorValue === undefined ? undefined : payloadText(errorValue),
    "bkn.operation.id": operation.fact.operation_id,
    "bkn.operation.attempt": operation.fact.attempt,
    "bkn.operation.protocol": operation.fact.protocol,
    "bkn.operation.source_module": operation.fact.source_module,
  });
}

function payloadText(value: unknown): string {
  return typeof value === "string" ? value : stringifyBigIntJSON(value);
}

function safeNanoString(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  ) {
    return String(value);
  }
  return undefined;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function technicalTraceQuery(
  query: TechnicalTraceQuery,
): Record<string, string | number> | undefined {
  const supported = new Set([
    "limit",
    "cursor",
    "from",
    "to",
    "status",
    "service",
    "tool",
    "agentOrApp",
    "traceId",
    "keyword",
    "errorKeyword",
    "conversationId",
    "interactionId",
  ]);
  const unknown = Object.keys(query).find((field) => !supported.has(field));
  if (unknown) throw new InputError(`Unknown technical Trace query field "${unknown}"`);
  const result: Record<string, string | number> = {};
  if (query.limit !== undefined && Number.isFinite(query.limit)) result.limit = query.limit;
  if (query.cursor) result.cursor = query.cursor;
  if (query.from) result.from = query.from;
  if (query.to) result.to = query.to;
  if (query.status) result.status = query.status;
  if (query.service) result.service = query.service;
  if (query.tool) result.tool = query.tool;
  if (query.agentOrApp) result.agent_or_app = query.agentOrApp;
  if (query.traceId) result.trace_id = query.traceId;
  if (query.keyword) result.keyword = query.keyword;
  if (query.errorKeyword) result.error_keyword = query.errorKeyword;
  if (query.conversationId) result.conversation_id = query.conversationId;
  if (query.interactionId) result.interaction_id = query.interactionId;
  return Object.keys(result).length ? result : undefined;
}
