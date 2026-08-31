// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import type { RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import { request } from "./http.js";

const LIFECYCLE = "/api/agent-observability/v1";
const FORBIDDEN_INPUT_FIELDS = new Set([
  "generation",
  "on_behalf_of",
  "onBehalfOf",
  "owner",
  "application_principal_id",
  "actor_subject",
  "actor_subject_type",
  "actor_subject_id",
  "effective_subject",
  "effective_subject_type",
  "effective_subject_id",
  "delegation_id",
]);
const OPAQUE_PAYLOAD_FIELDS = new Set(["input", "output", "error"]);

export type LifecycleErrorCode =
  | "conversation_required"
  | "conversation_not_found"
  | "conversation_closed"
  | "conversation_expired"
  | "conversation_owner_mismatch"
  | "interaction_required"
  | "interaction_in_progress"
  | "interaction_terminal"
  | "operation_required"
  | "idempotency_conflict"
  | "event_payload_conflict"
  | "receipt_pending"
  | "terminal_conflict"
  | "closure_manifest_invalid"
  | "feature_not_installed"
  | "capability_not_licensed"
  | "permission_denied"
  | "resource_not_disclosed";

export interface LifecycleError {
  code: LifecycleErrorCode;
  message: string;
  retryable: boolean;
  retry_after_ms: number;
  current_status?: string;
  required_action?: string;
  request_id?: string;
}

export interface LifecycleErrorEnvelope {
  error: LifecycleError;
}

export interface LifecycleOwner {
  application_principal_id: string;
  effective_subject_type: "user" | "service";
  effective_subject_id: string;
  delegation_id?: string;
}

export interface ManagedConversation {
  conversation_id: string;
  agent_name?: string;
  owner: LifecycleOwner;
  external_conversation_key: string;
  generation: number;
  status: "active" | "closed" | "expired";
  one_shot: boolean;
  row_version: number;
  created_at: string;
  updated_at: string;
  closed_at?: string;
}

export interface ConversationPage {
  entries: ManagedConversation[];
}

export interface ListConversationsQuery {
  limit?: number;
}

export interface ExpectedOperation {
  operation_id: string;
  required: boolean;
}

export interface ExpectedReceipt {
  receipt_id: string;
  required: boolean;
}

export interface EvidenceReference {
  evidence_ref: string;
  ref_type: "event" | "artifact" | "artifact_fragment" | "operation_output" | "claim";
  source_interaction_id: string;
  source_revision_id: string;
  source_operation_id?: string;
  artifact_ref?: string;
  fragment_selector?: string;
  version: string;
  content_hash: string;
  as_of?: string;
}

export interface ClaimSupport {
  target_ref: string;
  target_type: "evidence" | "claim" | "artifact_fragment" | "operation_output";
  source_interaction_id: string;
  source_revision_id: string;
  source_operation_id?: string;
  version: string;
  content_hash: string;
  fragment_selector?: string;
  role: string;
  status: "adopted" | "rejected";
  reason?: string;
}

export interface ManagedClaim {
  claim_id: string;
  claim_type: string;
  materiality: "material" | "supporting";
  claim_status: "asserted" | "withdrawn";
  content_artifact_ref: string;
  required_support_roles: string[];
  supports: ClaimSupport[];
}

export interface InteractionCompletionInput {
  terminal_idempotency_key: string;
  lease_token: string;
  lease_epoch: number;
  completion_manifest_version: string;
  completion_reason: string;
  answer_artifact_ref?: string;
  claims?: ManagedClaim[];
  expected_operations?: ExpectedOperation[];
  expected_receipts?: ExpectedReceipt[];
  assembler_deadline?: string;
}

export interface InteractionClosureManifest {
  completion_manifest_version: string;
  completion_reason: string;
  answer_artifact_ref?: string;
  claims?: ManagedClaim[];
  expected_operations?: ExpectedOperation[];
  expected_receipts?: ExpectedReceipt[];
  assembler_deadline?: string;
  system_partial_reasons?: string[];
}

export interface ManagedInteraction {
  interaction_id: string;
  conversation_id: string;
  ordinal: number;
  execution_status: "active" | "completed" | "failed" | "canceled" | "handed_off" | "abandoned";
  evidence_status: "not_applicable" | "assembling" | "complete" | "partial" | "failed";
  closure_manifest?: InteractionClosureManifest;
  lease_token: string;
  lease_epoch: number;
  lease_version: number;
  lease_expires_at: string;
  row_version: number;
  created_at: string;
  updated_at: string;
  terminal_at?: string;
}

export interface ManagedOperation {
  operation_id: string;
  conversation_id: string;
  interaction_id: string;
  operation_key: string;
  tool_name: string;
  parent_operation_id?: string;
  causation_event_ids?: string[];
  attempt: number;
  attempt_status: "ready" | "pending" | "completed" | "failed";
  retryable: boolean;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface LifecycleBusinessRef {
  ref_type: string;
  ref_id: string;
  version: string;
  as_of?: string;
  display_hint?: string;
}

export type EvidenceDurability = "pending" | "durable" | "failed";

export interface OperationReceipt {
  receipt_id: string;
  schema_version: string;
  owner: LifecycleOwner;
  conversation_id: string;
  interaction_id: string;
  operation_id: string;
  attempt: number;
  operation_key: string;
  tool_name: string;
  receipt_status: "pending" | "completed" | "failed";
  evidence_durability: EvidenceDurability;
  required: boolean;
  request_id: string;
  trace_id: string;
  causation_event_ids: string[];
  observed_evidence_refs: string[];
  business_refs: LifecycleBusinessRef[];
  artifact_refs: string[];
  partial_reasons: string[];
  row_version: number;
  issued_at: string;
  terminal_at?: string;
}

export interface OperationResult {
  operation: ManagedOperation;
  receipt: OperationReceipt;
  created: boolean;
  execute: boolean;
}

export type PayloadMode = "inline" | "referenced" | "omitted";
export type OperationProtocol = "mcp" | "sdk" | "internal";

export interface PayloadEnvelope {
  mode: PayloadMode;
  media_type: "application/json";
  byte_length?: number;
  inline?: unknown;
  ref?: string;
  omitted_reason?: "payload_too_large" | "serialization_failed";
}

export interface OperationCallFact {
  operation_id: string;
  attempt: number;
  conversation_id: string;
  interaction_id: string;
  receipt_id?: string;
  tool_name: string;
  protocol: OperationProtocol;
  source_module: string;
  parent_operation_id?: string;
  input: PayloadEnvelope;
  output?: PayloadEnvelope;
  error?: PayloadEnvelope;
  request_id?: string;
  trace_id?: string;
  span_id?: string;
  started_at: string;
  finished_at?: string;
  status: "ready" | "pending" | "completed" | "failed";
  retryable: boolean;
}

export interface OperationCallFactPage {
  entries: OperationCallFact[];
  total: number;
}

export interface EnsureConversationInput {
  external_conversation_key: string;
  idempotency_key?: string;
  one_shot?: boolean;
}

export interface CreateNewConversationGenerationInput extends EnsureConversationInput {
  idempotency_key: string;
}

export interface ResumeConversationInput {
  conversation_id: string;
}

export interface CloseConversationInput {
  idempotency_key?: string;
}

export interface StartInteractionInput {
  idempotency_key: string;
  agent_name?: string;
  lease_seconds?: number;
}

export interface EnsureOperationInput {
  operation_key: string;
  tool_name: string;
  protocol: OperationProtocol;
  source_module: string;
  input: PayloadEnvelope;
  parent_operation_id?: string;
  causation_event_ids?: string[];
  required?: boolean;
  lease_token: string;
  lease_epoch: number;
}

export interface RetryOperationAttemptInput {
  lease_token: string;
  lease_epoch: number;
}

export interface FinishOperationAttemptInput {
  receipt_id: string;
  output?: PayloadEnvelope;
  error?: PayloadEnvelope;
  evidence_durability: EvidenceDurability;
  retryable?: boolean;
  request_id?: string;
  trace_id?: string;
  span_id?: string;
  observed_evidence_refs?: string[];
  business_refs?: LifecycleBusinessRef[];
  artifact_refs?: string[];
  partial_reasons?: string[];
}

export interface TraceLifecycleApi {
  listConversations(query?: ListConversationsQuery): Promise<ConversationPage>;
  ensureConversation(input: EnsureConversationInput): Promise<ManagedConversation>;
  createNewConversationGeneration(
    input: CreateNewConversationGenerationInput,
  ): Promise<ManagedConversation>;
  resumeConversation(input: ResumeConversationInput): Promise<ManagedConversation>;
  getConversation(conversationId: string): Promise<ManagedConversation>;
  closeConversation(
    conversationId: string,
    input: CloseConversationInput,
  ): Promise<ManagedConversation>;
  startInteraction(
    conversationId: string,
    input: StartInteractionInput,
  ): Promise<ManagedInteraction>;
  getInteraction(interactionId: string): Promise<ManagedInteraction>;
  completeInteraction(
    interactionId: string,
    input: InteractionCompletionInput,
  ): Promise<ManagedInteraction>;
  failInteraction(
    interactionId: string,
    input: InteractionCompletionInput,
  ): Promise<ManagedInteraction>;
  cancelInteraction(
    interactionId: string,
    input: InteractionCompletionInput,
  ): Promise<ManagedInteraction>;
  handoffInteraction(
    interactionId: string,
    input: InteractionCompletionInput,
  ): Promise<ManagedInteraction>;
  ensureOperation(
    conversationId: string,
    interactionId: string,
    input: EnsureOperationInput,
  ): Promise<OperationResult>;
  getOperation(operationId: string): Promise<ManagedOperation>;
  getOperationAttempt(operationId: string, attempt: number): Promise<OperationCallFact>;
  listInteractionOperations(interactionId: string): Promise<OperationCallFactPage>;
  retryOperationAttempt(
    operationId: string,
    input: RetryOperationAttemptInput,
  ): Promise<OperationResult>;
  completeOperationAttempt(
    operationId: string,
    attempt: number,
    input: FinishOperationAttemptInput,
  ): Promise<OperationResult>;
  failOperationAttempt(
    operationId: string,
    attempt: number,
    input: FinishOperationAttemptInput,
  ): Promise<OperationResult>;
  getReceipt(receiptId: string): Promise<OperationReceipt>;
}

export function traceLifecycleApi(ctx: RequestContext): TraceLifecycleApi {
  const post = async <T>(path: string, input: object): Promise<T> => {
    assertNoForbiddenInputFields(input);
    return await request<T>(ctx, `${LIFECYCLE}${path}`, { method: "POST", body: input });
  };
  const get = <T>(path: string): Promise<T> =>
    request<T>(ctx, `${LIFECYCLE}${path}`, { method: "GET" });
  const interactionTerminal = (
    interactionId: string,
    action: "complete" | "fail" | "cancel" | "handoff",
    input: InteractionCompletionInput,
  ): Promise<ManagedInteraction> =>
    post(`/interactions/${encodeURIComponent(interactionId)}/${action}`, input);
  const finishAttempt = (
    operationId: string,
    attempt: number,
    action: "complete" | "fail",
    input: FinishOperationAttemptInput,
  ): Promise<OperationResult> =>
    post(
      `/operations/${encodeURIComponent(operationId)}/attempts/${encodeURIComponent(String(attempt))}:${action}`,
      withTraceCorrelation(ctx, input),
    );

  return {
    listConversations: (query = {}) => {
      const params = new URLSearchParams();
      if (query.limit !== undefined && Number.isFinite(query.limit)) {
        params.set("limit", String(query.limit));
      }
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      return get(`/conversations${suffix}`);
    },
    ensureConversation: (input) => post("/conversations:ensure-current", input),
    createNewConversationGeneration: (input) => post("/conversations:create-new-generation", input),
    resumeConversation: (input) => post("/conversations:resume-by-id", input),
    getConversation: (conversationId) =>
      get(`/conversations/${encodeURIComponent(conversationId)}`),
    closeConversation: (conversationId, input) =>
      post(`/conversations/${encodeURIComponent(conversationId)}/close`, input),
    startInteraction: (conversationId, input) =>
      post(`/conversations/${encodeURIComponent(conversationId)}/interactions`, input),
    getInteraction: (interactionId) => get(`/interactions/${encodeURIComponent(interactionId)}`),
    completeInteraction: (interactionId, input) =>
      interactionTerminal(interactionId, "complete", input),
    failInteraction: (interactionId, input) => interactionTerminal(interactionId, "fail", input),
    cancelInteraction: (interactionId, input) =>
      interactionTerminal(interactionId, "cancel", input),
    handoffInteraction: (interactionId, input) =>
      interactionTerminal(interactionId, "handoff", input),
    ensureOperation: (conversationId, interactionId, input) =>
      post(
        `/conversations/${encodeURIComponent(conversationId)}/interactions/${encodeURIComponent(interactionId)}/operations:ensure`,
        input,
      ),
    getOperation: (operationId) => get(`/operations/${encodeURIComponent(operationId)}`),
    getOperationAttempt: (operationId, attempt) =>
      get(
        `/operations/${encodeURIComponent(operationId)}/attempts/${encodeURIComponent(String(attempt))}`,
      ),
    listInteractionOperations: (interactionId) =>
      get(`/interactions/${encodeURIComponent(interactionId)}/operations`),
    retryOperationAttempt: (operationId, input) =>
      post(`/operations/${encodeURIComponent(operationId)}/attempts`, input),
    completeOperationAttempt: (operationId, attempt, input) =>
      finishAttempt(operationId, attempt, "complete", input),
    failOperationAttempt: (operationId, attempt, input) =>
      finishAttempt(operationId, attempt, "fail", input),
    getReceipt: (receiptId) => get(`/receipts/${encodeURIComponent(receiptId)}`),
  };
}

function withTraceCorrelation(
  ctx: RequestContext,
  input: FinishOperationAttemptInput,
): FinishOperationAttemptInput {
  const traceparent = ctx.trace?.traceparent.split("-");
  return {
    ...input,
    request_id: input.request_id ?? ctx.trace?.requestId,
    trace_id: input.trace_id ?? traceparent?.[1],
    span_id: input.span_id ?? traceparent?.[2],
  };
}

function assertNoForbiddenInputFields(input: object): void {
  const pending: unknown[] = [input];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== "object" || value === null || seen.has(value)) continue;
    seen.add(value);
    for (const [field, nested] of Object.entries(value)) {
      if (FORBIDDEN_INPUT_FIELDS.has(field)) {
        throw new InputError(`Lifecycle input field "${field}" is not allowed`);
      }
      if (!(OPAQUE_PAYLOAD_FIELDS.has(field) && isPayloadEnvelope(nested))) pending.push(nested);
    }
  }
}

function isPayloadEnvelope(value: unknown): value is PayloadEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.mode === "inline" ||
      candidate.mode === "referenced" ||
      candidate.mode === "omitted") &&
    candidate.media_type === "application/json"
  );
}
