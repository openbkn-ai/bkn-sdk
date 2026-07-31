// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * @openbkn/bkn-sdk — library entry.
 * Re-exports the client factory, resource namespaces, and shared types.
 * No side effects on import.
 */
export { createClient, type BknClient } from "./client.js";
export type { ClientOptions, RequestContext } from "./types.js";
export {
  DEFAULT_BUSINESS_DOMAIN,
  DEFAULT_LIST_LIMIT,
  DEFAULT_QUERY_LIMIT,
} from "./types.js";
export { HttpError, InputError } from "./utils/errors.js";
export {
  TraceSession,
  type ActionHandle,
  type ActionResultInput,
  type BusinessRefInput,
  type BusinessRefsInput,
  type ClaimInput,
  type EvidenceRefInput,
  type EvidenceRefsInput,
  type ExecuteActionInput,
  type InteractionInput,
  type OperationEventPayloadMap,
  type OperationEventType,
  type OperationInput,
  type RecommendActionInput,
  type TraceSessionOptions,
} from "./trace-session.js";

// Resource namespaces (advanced: use with a resolved RequestContext).
export { admin } from "./resources/admin.js";
export { agents } from "./resources/agents.js";
export { context } from "./resources/context-loader.js";
export { dataflows } from "./resources/dataflows.js";
export { kn } from "./resources/knowledge-networks.js";
export { models } from "./resources/models.js";
export { resources } from "./resources/resources.js";
export { skills } from "./resources/skills.js";
export { toolboxes } from "./resources/toolboxes.js";
export { trace } from "./resources/trace.js";
export { vega } from "./resources/vega.js";

// Auth is store-backed (pre-token), so it is a standalone namespace.
export * as auth from "./resources/auth.js";

export type {
  ActionSummary,
  BusinessEvidenceEventType,
  BusinessGraphResponse,
  EvidenceArtifact,
  EvidenceArtifactIngestResponse,
  EvidenceArtifactType,
  EvidenceEvent,
  EvidenceChainResponse,
  EvidenceIngestRequest,
  EvidenceIngestResponse,
  EvidenceTraceContext,
  GraphPage,
  InteractionSummary,
  RequestSummary,
  RequestSummaryQuery,
  SnapshotPreviewResponse,
  SummaryPage,
  TraceExecutionSummary,
  TraceGraphEdge,
  TraceGraphNode,
  TraceQueryOptions,
  TraceGraphResponse,
  TraceScope,
  VisibilitySummary,
} from "./api/trace.js";

// Vega build types are part of the public contract.
export type {
  BuildMode,
  BuildTask,
  CatalogConnectionTestRequest,
  CatalogConnectionTestResult,
  CatalogHealthCheckSchedule,
  CatalogHealthCheckScheduleMode,
  CatalogHealthCheckScheduleRequest,
  CatalogHealthCheckStatus,
  CatalogHealthStatus,
  CatalogWriteOptions,
  CreateBuildTaskRequest,
  CreateCatalogRequest,
  DslRawQueryRequest,
  QueryPagingMode,
  RawQueryContinuationRequest,
  RawQueryPaging,
  RawQueryRequest,
  SqlRawQueryRequest,
  UpdateCatalogRequest,
} from "./api/vega.js";

// Low-level escape hatch for endpoints not yet wrapped.
export { request } from "./api/http.js";
export { resolveContext } from "./config/resolve.js";
