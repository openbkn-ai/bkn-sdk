// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Observability operation-audit log client (agent-observability
 * `GET /api/observability/v1/logs[/{event_id}]`). Replaces the retired bkn-safe
 * `GET /admin/audit-logs` reader. Wire shapes follow the server's
 * `rdto.OperationAuditRecord` / `LogListResponse` (code is the source of truth;
 * the published OpenAPI still lists legacy technical-log params the handler rejects).
 */
import { z } from "zod";
import type { RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import { request } from "./http.js";

const LOGS = "/api/observability/v1/logs";

/** Server page-size bounds (`limit` / `page_size`). */
export const AUDIT_LOG_MIN_LIMIT = 20;
export const AUDIT_LOG_MAX_LIMIT = 200;

/** Categories that hold management and security audit records. */
export const AUDIT_LOG_CATEGORIES = ["audit.admin", "audit.security"] as const;
export type AuditLogCategory = (typeof AUDIT_LOG_CATEGORIES)[number];

export const AUDIT_LOG_OUTCOMES = ["success", "failure", "denied", "canceled", "unknown"] as const;
export type AuditLogOutcome = (typeof AUDIT_LOG_OUTCOMES)[number];

/** Outcomes that `--failed-only` stands for (the server rejects `failed_only`). */
export const AUDIT_FAILED_OUTCOMES: AuditLogOutcome[] = ["failure", "denied"];

/** Filters for GET /logs. All filters combine with AND. */
export interface AuditLogQuery {
  /** Defaults to `audit.admin` + `audit.security`. */
  categories?: string[];
  /** Free text over safe summary and low-sensitivity fields (max 512). */
  q?: string;
  /** Token subject id of the actor. */
  actorId?: string;
  /** Actor display-name search. */
  actor?: string;
  requestId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  outcomes?: string[];
  /** Inclusive lower bound, RFC 3339. */
  from?: string;
  /** Exclusive upper bound, RFC 3339. */
  to?: string;
  /** One-based page number (default 1). */
  page?: number;
  /** Opaque cursor from a previous `next_cursor`; takes precedence over `page`. */
  cursor?: string;
  /** Page size, 20..200 (server default 50). */
  limit?: number;
}

const AuditRecordSchema = z
  .object({
    event_id: z.string(),
    log_category: z.string(),
    event_name: z.string().optional(),
    event_time: z.string().optional(),
    recorded_at: z.string().optional(),
    actor_id: z.string().optional(),
    actor_name_snapshot: z.string().optional(),
    actor_type: z.string().optional(),
    auth_method: z.string().optional(),
    credential_id: z.string().optional(),
    credential_name: z.string().optional(),
    source_channel: z.string().optional(),
    source_id: z.string().optional(),
    business_module: z.string().optional(),
    outcome: z.string().optional(),
    failure_code: z.string().optional(),
    failure_message: z.string().optional(),
    facts: z
      .object({
        action: z.string().optional(),
        method: z.string().optional(),
        status_code: z.number().optional(),
        client_ip: z.string().optional(),
        target_type: z.string().optional(),
        target_id: z.string().optional(),
        target_name_snapshot: z.string().optional(),
        detail: z.record(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    correlation: z
      .object({
        request_id: z.string().optional(),
        trace_id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    attributes: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type AuditLogRecord = z.infer<typeof AuditRecordSchema>;

const AuditPageSchema = z
  .object({
    data: z.array(AuditRecordSchema),
    next_cursor: z.string().nullish(),
    partial: z.boolean().optional(),
    count: z
      .object({ value: z.number().nullable().optional(), accuracy: z.string().optional() })
      .passthrough()
      .optional(),
    pagination: z.object({ page: z.number(), page_size: z.number() }).passthrough().optional(),
    source_status: z.array(z.record(z.unknown())).optional(),
    request_trace_context: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type AuditLogPage = z.infer<typeof AuditPageSchema>;

const AuditDetailSchema = z
  .object({
    data: AuditRecordSchema,
    field_projection: z.record(z.unknown()).optional(),
    request_trace_context: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type AuditLogDetail = z.infer<typeof AuditDetailSchema>;

function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`Unexpected ${what} response shape: ${parsed.error.issues[0]?.message ?? ""}`);
  }
  return parsed.data;
}

/** GET /api/observability/v1/logs — audit records, newest first. */
export async function listAuditLogs(
  ctx: RequestContext,
  query: AuditLogQuery = {},
): Promise<AuditLogPage> {
  if (
    query.limit !== undefined &&
    (!Number.isInteger(query.limit) ||
      query.limit < AUDIT_LOG_MIN_LIMIT ||
      query.limit > AUDIT_LOG_MAX_LIMIT)
  ) {
    throw new InputError(
      `Audit log limit must be an integer between ${AUDIT_LOG_MIN_LIMIT} and ${AUDIT_LOG_MAX_LIMIT}; got ${query.limit}.`,
    );
  }
  if (query.page !== undefined && (!Number.isInteger(query.page) || query.page < 1)) {
    throw new InputError(`Audit log page must be a positive integer; got ${query.page}.`);
  }
  if (query.q !== undefined && query.q.length > 512) {
    throw new InputError("Audit log search text (q) must be at most 512 characters.");
  }
  const categories = query.categories?.length ? query.categories : [...AUDIT_LOG_CATEGORIES];
  const body = await request<unknown>(ctx, LOGS, {
    query: {
      categories,
      q: query.q || undefined,
      actor_id: query.actorId || undefined,
      actor: query.actor || undefined,
      request_id: query.requestId || undefined,
      action: query.action || undefined,
      target_type: query.targetType || undefined,
      target_id: query.targetId || undefined,
      outcomes: query.outcomes?.length ? query.outcomes : undefined,
      time_from: query.from || undefined,
      time_to: query.to || undefined,
      page: query.page,
      cursor: query.cursor || undefined,
      limit: query.limit,
    },
  });
  return parseOrThrow(AuditPageSchema, body, "audit log list");
}

/** GET /api/observability/v1/logs/{event_id} — one audit record. */
export async function getAuditLog(ctx: RequestContext, id: string): Promise<AuditLogDetail> {
  const body = await request<unknown>(ctx, `${LOGS}/${encodeURIComponent(id)}`);
  return parseOrThrow(AuditDetailSchema, body, "audit log detail");
}
