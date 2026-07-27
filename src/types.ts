// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Shared types for the SDK surface. No runtime, no side effects. */

/** Options a caller supplies; any field may be resolved from env/config store. */
export interface ClientOptions {
  baseUrl?: string;
  token?: string;
  /** Specific user credentials (transient); maps to legacy `--user`. */
  user?: string;
  /** Business domain header; defaults to `bd_public`. */
  businessDomain?: string;
  /** Skip TLS verification (dev / self-signed only). */
  insecure?: boolean;
  /** Dedicated producer credential, sent only to BKN Trace evidence write endpoints. */
  evidenceIngestToken?: string;
  /** Optional BKN Trace phase-one context for request correlation. */
  trace?: TraceContextOptions;
}

/** Fully resolved request context — every field is known. */
export interface RefreshableTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
}

export interface RequestContext {
  baseUrl: string;
  token: string;
  businessDomain: string;
  insecure: boolean;
  /** Dedicated producer credential; never sent to read or non-Trace endpoints. */
  evidenceIngestToken?: string;
  /** Stable per-client BKN Trace context propagated on outbound requests. */
  trace?: TraceContext;
  /**
   * Stored-credential refresh: on a 401, swap the refresh token for a fresh
   * access token, persist it, and retry once. Absent for explicit `--token`/env.
   */
  refresh?: {
    refreshToken: string;
    clientId?: string;
    persist: (tokens: RefreshableTokens) => void;
  };
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

export const DEFAULT_BUSINESS_DOMAIN = "bd_public";

/** Default list/query limits — see AGENTS.md conventions. */
export const DEFAULT_LIST_LIMIT = 30;
export const DEFAULT_QUERY_LIMIT = 50;
