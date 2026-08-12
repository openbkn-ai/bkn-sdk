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
export { HttpError, InputError, ToolError } from "./utils/errors.js";
// A long-lived embedder opens managed interactions the same way the CLI does,
// and needs the same way to hand them back.
export { releaseLifecycleSessions } from "./api/lifecycle.js";
export type { BknContext } from "./api/lifecycle.js";
export {
  ManagedTrace,
  type BknBusinessContext,
  type ConversationStrategy,
  type ManagedCompletionInput,
  type ManagedInteractionScope,
  type ManagedOperationCall,
  type ManagedOperationInput,
  type ManagedOperationResult,
  type ManagedTraceOptions,
  type SupportCandidate,
} from "./managed-trace.js";
export {
  type ClaimSupport,
  type CloseConversationInput,
  type ConversationPage,
  type CreateNewConversationGenerationInput,
  type EnsureConversationInput,
  type EnsureOperationInput,
  type EvidenceDurability,
  type EvidenceReference,
  type ExpectedOperation,
  type ExpectedReceipt,
  type FinishOperationAttemptInput,
  type InteractionCompletionInput,
  type LifecycleError,
  type LifecycleErrorCode,
  type LifecycleErrorEnvelope,
  type LifecycleOwner,
  type LifecycleBusinessRef,
  type ListConversationsQuery,
  type ManagedClaim,
  type ManagedConversation,
  type ManagedInteraction,
  type ManagedOperation,
  type OperationReceipt,
  type OperationCallFact,
  type OperationCallFactPage,
  type OperationResult,
  type OperationProtocol,
  type PayloadEnvelope,
  type PayloadMode,
  type ResumeConversationInput,
  type RetryOperationAttemptInput,
  type StartInteractionInput,
  type TraceLifecycleApi,
  traceLifecycleApi,
} from "./api/trace-lifecycle.js";

// Resource namespaces (advanced: use with a resolved RequestContext).
export { admin } from "./resources/admin.js";
export { agents } from "./resources/agents.js";
export { context } from "./resources/context-loader.js";
export type { ManagedToolResult, ToolCallOptions } from "./api/context-loader.js";
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
  GraphPage,
  TraceExecutionSummary,
  TraceGraphEdge,
  TraceGraphNode,
  TraceGraphResponse,
  VisibilitySummary,
} from "./api/trace.js";

// Skill execution + file-read types are part of the public contract.
export type {
  ExecuteSkillOptions,
  SkillContentResponse,
  SkillExecutionResult,
  SkillFileEntry,
  SkillReadFileResponse,
  SkillResponseMode,
  SkillView,
} from "./api/skills.js";
export type { SkillViewOptions } from "./resources/skills.js";
export type { SkillChild, SkillDirChild, SkillFileChild } from "./utils/skill-tree.js";

// Vega build types are part of the public contract.
export type {
  BuildMode,
  BuildTask,
  BuildTaskStatus,
  BuildTaskSummary,
  CatalogConnectionTestRequest,
  CatalogConnectionTestResult,
  CatalogDeletionBlocker,
  CatalogDeletionImpact,
  CatalogDeletionTaskImpact,
  CatalogHealthCheckSchedule,
  CatalogHealthCheckScheduleMode,
  CatalogHealthCheckScheduleRequest,
  CatalogHealthCheckStatus,
  CatalogHealthStatus,
  CatalogWriteOptions,
  CreateBuildTaskRequest,
  CreateCatalogRequest,
  DeleteCatalogOptions,
  DeleteCatalogResult,
  DslRawQueryRequest,
  QueryPagingMode,
  ListBuildTasksOptions,
  ListBuildTasksResponse,
  RawQueryContinuationRequest,
  RawQueryPaging,
  RawQueryRequest,
  SqlRawQueryRequest,
  UpdateCatalogRequest,
} from "./api/vega.js";

// Low-level escape hatch for endpoints not yet wrapped.
export { request } from "./api/http.js";
export { resolveContext } from "./config/resolve.js";
