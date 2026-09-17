// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Shared types for the SDK surface. No runtime, no side effects. */

import type { RetryNotice } from "./api/tls.js";

/** Options a caller supplies; any field may be resolved from env/config store. */
export interface ClientOptions {
  baseUrl?: string;
  token?: string;
  /** Specific user credentials (transient); maps to legacy `--user`. */
  user?: string;
  /** Skip TLS verification (dev / self-signed only). */
  insecure?: boolean;
  /**
   * Retry transient transport failures — a connection that was never made, or
   * a dropped one or a 429/502/503 on a read — up to three times. Default true.
   */
  retry?: boolean;
  /** Called before each such retry; the CLI prints one line to stderr. */
  onRetry?: (notice: RetryNotice) => void;
  /** Optional BKN Trace phase-one context for request correlation. */
  trace?: TraceContextOptions;
  /**
   * A conversation this caller opened earlier and is willing to continue.
   *
   * Distinct from `trace.conversationId`, which names someone else's: that one
   * is taken at its word and its failures are the caller's to see. This one is
   * a convenience, so a session that cannot join it is opened fresh instead —
   * otherwise a conversation that has been swept, or still holds an active
   * interaction, would fail every later run with no way back except a manual
   * reset.
   *
   * Honoured only on a `managed-v2` deploy, for the reason
   * {@link ClientOptions.onConversationOpened} gives: a v1 interaction cannot be
   * ended early, so joining one would block the next call for its lease. On v1
   * this field is ignored and a fresh conversation is opened instead.
   */
  rememberedConversationId?: string;
  /**
   * Called with the id of a conversation the managed lifecycle opened on this
   * caller's behalf — never for one the caller named itself.
   *
   * May fire more than once in a process: sessions are per knowledge network,
   * and a session that goes stale is reopened. Each call reports a conversation
   * that now exists; a caller keeping only one decides which (the CLI keeps the
   * last). Make the handler idempotent.
   *
   * Only fires on a `managed-v2` deploy. A v1 interaction cannot be ended
   * early, and a conversation permits one at a time, so a v1 conversation
   * handed to a later call would be refused until its lease expired.
   *
   * The hook exists so persistence stays a decision of whoever built the
   * client. The CLI uses it to remember a conversation across invocations; a
   * library consumer that omits it gets a fresh conversation per process and
   * nothing written to disk.
   */
  onConversationOpened?: (conversationId: string) => void;
  /**
   * The `agent_name` sent on `bkn_start_interaction` when the SDK opens a managed
   * interaction on this caller's behalf. Defaults to `openbkn-sdk`. Keep it
   * stable: the contract wants the same name on every start in one conversation.
   */
  agentName?: string;
  /** @internal CLI clients persist successful version checks for a short TTL. */
  versionCheckMode?: "memory" | "cli";
}

/** Fully resolved request context — every field is known. */
export interface RefreshableTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Access-token expiry (ISO 8601), when the grant reported one. */
  expiresAt?: string;
}

export interface RequestContext {
  baseUrl: string;
  token: string;
  insecure: boolean;
  /** See {@link ClientOptions.retry}; absent means on. */
  retry?: boolean;
  /** See {@link ClientOptions.onRetry}. */
  onRetry?: (notice: RetryNotice) => void;
  /**
   * The token came from `BKN_TOKEN`, shadowing any `auth login` session. A 401
   * then says so — otherwise a fresh login looks broken for no visible reason.
   */
  tokenFromEnv?: boolean;
  /** Stable per-client BKN Trace context propagated on outbound requests. */
  trace?: TraceContext;
  /**
   * Stored-credential refresh: swap the refresh token for a fresh access token
   * shortly before it expires, or on a 401 (then retry once), and persist it.
   * Absent for explicit `--token`/env.
   */
  refresh?: {
    refreshToken: string;
    clientId?: string;
    /** Expiry of the current `token` (ISO 8601) — what an opaque token has instead of `exp`. */
    expiresAt?: string;
    persist: (tokens: RefreshableTokens) => void;
  };
  /** See {@link ClientOptions.rememberedConversationId}. */
  rememberedConversationId?: string;
  /** See {@link ClientOptions.onConversationOpened}. */
  onConversationOpened?: (conversationId: string) => void;
  /** See {@link ClientOptions.agentName}. */
  agentName?: string;
}

export interface TraceContextOptions {
  /** OpenBKN request id. Generated as `req_<uuid>` when omitted or invalid. */
  requestId?: string;
  /** W3C Trace Context header. Generated when omitted or invalid. */
  traceparent?: string;
  /** Caller-owned business conversation id. The SDK never generates one. */
  conversationId?: string;
  /** Caller-owned id for one user question and its operations. The SDK never generates one. */
  interactionId?: string;
  /** Replay-stable operation id. Transports generate one per logical operation when omitted. */
  operationId?: string;
  /** Retry ordinal for the operation. Defaults to 1. */
  attempt?: number;
  /** Producer observation time in RFC3339 format. Generated per logical operation when omitted. */
  observedAt?: string;
  /** Baggage values are allowlisted before propagation. */
  baggage?: Record<string, string>;
}

export interface TraceContext {
  requestId: string;
  traceparent: string;
  conversationId?: string;
  interactionId?: string;
  operationId?: string;
  attempt?: number;
  observedAt?: string;
  baggage?: Record<string, string>;
}

export interface FixedMaskRule {
  kind: "fixed";
  replacement: string;
}

export interface PartialMaskRule {
  kind: "partial";
  keep_start: number;
  keep_end: number;
  replacement: string;
}

export interface EmailMaskRule {
  kind: "email";
  local_keep_start: number;
  preserve_domain: boolean;
  replacement: string;
}

export interface RoundMaskRule {
  kind: "round";
  step: number;
}

export interface DateGranularityMaskRule {
  kind: "date_granularity";
  granularity: "year" | "month" | "day" | "hour";
}

/** Optional masking contract carried by a DataProperty definition. */
export type DataPropertyMaskRule =
  | FixedMaskRule
  | PartialMaskRule
  | EmailMaskRule
  | RoundMaskRule
  | DateGranularityMaskRule;

/** REST/SDK representation of an object type data property. */
export interface DataPropertyDefinition {
  name: string;
  display_name: string;
  type: string;
  comment?: string;
  mapped_field?: {
    name: string;
    type?: string;
    display_name?: string;
    comment?: string;
  };
  mask_rule?: DataPropertyMaskRule;
  condition_operations?: string[];
}

/** Default list/query limits — see AGENTS.md conventions. */
export const DEFAULT_LIST_LIMIT = 30;
export const DEFAULT_QUERY_LIMIT = 50;
