// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { randomUUID } from "node:crypto";
import type {
  BusinessEvidenceEventType,
  EvidenceEvent,
  EvidenceIngestRequest,
  EvidenceIngestResponse,
  EvidenceTraceContext,
} from "./api/trace.js";

type EvidenceEmitter = (body: EvidenceIngestRequest) => Promise<EvidenceIngestResponse>;
type IDFactory = () => string;

export interface TraceSessionOptions {
  trace: EvidenceTraceContext;
  producerModule: string;
  spanId: string;
  interactionId?: string;
  emit: EvidenceEmitter;
  idFactory?: IDFactory;
  now?: () => string;
}

interface InteractionBase {
  operationName: string;
  intentHash: string;
  mode: "chat" | "task" | "background";
}

export type InteractionInput = InteractionBase &
  ({ agentId: string; appRef?: string } | { agentId?: string; appRef: string });

export interface OperationEventPayloadMap {
  "retrieval.completed": {
    query_hash: string;
    candidate_count: number;
    truncated: boolean;
    version_status?: string;
    source_refs?: string[];
  };
  "knowledge.read.observed": {
    kn_id: string;
    read_kind: string;
    version_status: string;
    schema_version?: string;
    business_refs?: string[];
  };
  "data.query.observed": {
    query_hash: string;
    query_type: string;
    row_count: number;
    truncated?: boolean;
    as_of?: string;
    version_status?: string;
    resource_refs?: string[];
    field_refs?: string[];
  };
  "model.call.observed": {
    model_name: string;
    model_provider: string;
    status: "ok" | "error";
    input_token_count: number;
    output_token_count: number;
    prompt_hash: string;
    output_hash: string;
    error_category?: string;
    error_hash?: string;
  };
  "tool.called": {
    tool_id: string;
    tool_name: string;
    args_hash: string;
    visibility: string;
    version_status: string;
  };
  "tool.result.observed": {
    tool_id: string;
    tool_name: string;
    status: "success" | "error";
    result_hash?: string;
    error_hash?: string;
    visibility: string;
    version_status: string;
  };
}

export type OperationEventType = keyof OperationEventPayloadMap;

export interface OperationInput<T extends OperationEventType = OperationEventType> {
  operationName: string;
  causationEventId: string;
  operationId?: string;
  attempt?: number;
  claimId?: string;
  payload: OperationEventPayloadMap[T];
}

export interface ClaimInput {
  operationName: string;
  causationEventId: string;
  claimId: string;
  claimType: "answer" | "recommendation" | "structured_output" | "finding";
  claimHash: string;
  sourceEventIds: string[];
  operationIds: string[];
  visibility?: string;
  versionStatus?: string;
}

export interface EvidenceRefInput {
  refId: string;
  refType: string;
  sourceSystem: string;
  validity: "observed" | "available" | "unavailable" | "expired" | "partial";
  versionStatus: "versioned" | "unversioned" | "not_auditable";
  visibility: "visible" | "redacted" | "hidden" | "omitted" | "unresolved" | "unauthorized";
  summaryHash?: string;
}

export interface EvidenceRefsInput {
  operationName: string;
  claimId: string;
  causationEventId?: string;
  refs: EvidenceRefInput[];
}

export interface BusinessRefInput {
  refId: string;
  refType: "knowledge_network" | "object" | "property" | "relation" | "metric" | "logic" | "action";
  sourceSystem: string;
  validity: "observed" | "available" | "unavailable" | "expired" | "partial";
  versionStatus: "versioned" | "unversioned" | "not_auditable";
  visibility: "visible" | "redacted" | "hidden" | "omitted" | "unresolved" | "unauthorized";
}

export interface BusinessRefsInput {
  operationName: string;
  claimId: string;
  causationEventId?: string;
  resolverStatus: "resolved" | "partial" | "unresolved";
  refs: BusinessRefInput[];
}

export interface ActionHandle {
  readonly actionInstanceId: string;
  readonly claimId: string;
  readonly operationId: string;
  readonly lastEventId: string;
  readonly state:
    | "recommended"
    | "approval_requested"
    | "approved"
    | "rejected"
    | "executed"
    | "result_recorded";
}

export interface RecommendActionInput {
  operationName: string;
  claimId: string;
  actionType: string;
  targetRefs: string[];
  reasonHash: string;
  causationEventId?: string;
}

interface InternalAction {
  actionInstanceId: string;
  claimId: string;
  operationId: string;
  lastEventId: string;
  state: ActionHandle["state"];
}

export type ExecuteActionInput =
  | { status: "ok"; invocationRef: string }
  | { status: "error"; invocationRef: string; errorCategory: string; errorHash: string };

export type ActionResultInput = { status: string; resultHash: string } & (
  | { taskRef: string; artifactRef?: string }
  | { taskRef?: string; artifactRef: string }
);

const PAYLOAD_FIELDS: Record<BusinessEvidenceEventType, Set<string>> = {
  "agent.interaction.started": new Set(["intent_hash", "mode", "agent_id", "app_ref"]),
  "retrieval.completed": new Set([
    "query_hash",
    "candidate_count",
    "truncated",
    "version_status",
    "source_refs",
  ]),
  "knowledge.read.observed": new Set([
    "kn_id",
    "read_kind",
    "version_status",
    "schema_version",
    "business_refs",
  ]),
  "data.query.observed": new Set([
    "query_hash",
    "query_type",
    "row_count",
    "truncated",
    "as_of",
    "version_status",
    "resource_refs",
    "field_refs",
  ]),
  "model.call.observed": new Set([
    "model_name",
    "model_provider",
    "status",
    "input_token_count",
    "output_token_count",
    "prompt_hash",
    "output_hash",
    "error_category",
    "error_hash",
  ]),
  "tool.called": new Set(["tool_id", "tool_name", "args_hash", "visibility", "version_status"]),
  "tool.result.observed": new Set([
    "tool_id",
    "tool_name",
    "status",
    "result_hash",
    "result_length",
    "result_count",
    "error_hash",
    "error_category",
    "visibility",
    "version_status",
  ]),
  "claim.created": new Set([
    "claim_id",
    "claim_type",
    "claim_hash",
    "source_event_ids",
    "operation_ids",
    "visibility",
    "version_status",
  ]),
  "evidence.refs.created": new Set(["claim_id", "evidence_refs"]),
  "business.refs.resolved": new Set(["claim_id", "resolver_status", "business_refs"]),
  "action.recommended": new Set([
    "action_instance_id",
    "action_type",
    "target_refs",
    "reason_hash",
    "status",
  ]),
  "action.approval_requested": new Set(["action_instance_id", "policy_ref", "status"]),
  "action.approved": new Set(["action_instance_id", "actor_ref", "policy_decision_ref", "status"]),
  "action.rejected": new Set(["action_instance_id", "actor_ref", "policy_decision_ref", "status"]),
  "action.executed": new Set([
    "action_instance_id",
    "status",
    "invocation_ref",
    "error_category",
    "error_hash",
  ]),
  "action.result_recorded": new Set([
    "action_instance_id",
    "status",
    "result_hash",
    "task_ref",
    "artifact_ref",
  ]),
};

const REQUIRED_PAYLOAD_FIELDS: Partial<Record<BusinessEvidenceEventType, string[]>> = {
  "agent.interaction.started": ["intent_hash", "mode"],
  "retrieval.completed": ["query_hash", "candidate_count", "truncated"],
  "knowledge.read.observed": ["kn_id", "read_kind", "version_status"],
  "data.query.observed": ["query_hash", "query_type", "row_count"],
  "model.call.observed": [
    "model_name",
    "model_provider",
    "status",
    "input_token_count",
    "output_token_count",
    "prompt_hash",
    "output_hash",
  ],
  "tool.called": ["tool_id", "tool_name", "args_hash", "visibility", "version_status"],
  "tool.result.observed": ["tool_id", "tool_name", "status", "visibility", "version_status"],
  "claim.created": [
    "claim_id",
    "claim_type",
    "claim_hash",
    "source_event_ids",
    "operation_ids",
    "visibility",
    "version_status",
  ],
  "evidence.refs.created": ["claim_id", "evidence_refs"],
  "business.refs.resolved": ["claim_id", "resolver_status", "business_refs"],
  "action.recommended": [
    "action_instance_id",
    "action_type",
    "target_refs",
    "reason_hash",
    "status",
  ],
  "action.approval_requested": ["action_instance_id", "policy_ref", "status"],
  "action.approved": ["action_instance_id", "actor_ref", "policy_decision_ref", "status"],
  "action.rejected": ["action_instance_id", "actor_ref", "policy_decision_ref", "status"],
  "action.executed": ["action_instance_id", "status", "invocation_ref"],
  "action.result_recorded": ["action_instance_id", "status", "result_hash"],
};

const REF_FIELDS = new Set([
  "ref_id",
  "ref_type",
  "source_system",
  "validity",
  "version_status",
  "visibility",
  "summary_hash",
]);
const RAW_KEYS = new Set([
  "authorization",
  "cookie",
  "access_token",
  "refresh_token",
  "id_token",
  "api_key",
  "password",
  "private_key",
  "prompt",
  "user_question",
  "approval_comment",
  "sql",
  "query_params",
  "rows",
]);
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const RAW_VALUE_PATTERNS = [
  /bearer\s+[A-Za-z0-9._-]+/i,
  /\bselect\s+.+\s+from\b/is,
  /\binsert\s+into\b/i,
  /\bupdate\s+\S+\s+set\b/i,
  /\bdelete\s+from\b/i,
  /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/,
  /https?:\/\/[^\s"']+/i,
];

function defaultNow(): string {
  return new Date().toISOString();
}

function assertSessionOptions(options: TraceSessionOptions): void {
  const trace = options.trace;
  if (!/^[0-9a-f]{32}$/.test(trace.trace_id)) throw new Error("trace_id must be 32 hex characters");
  const traceparent = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(trace.traceparent);
  if (!traceparent || traceparent[1] !== trace.trace_id) {
    throw new Error("traceparent must be valid and match trace_id");
  }
  if (!/^req_[0-9A-Za-z_.-]+$/.test(trace["bkn.request.id"])) {
    throw new Error("bkn.request.id must start with req_");
  }
  if (!trace["bkn.tenant.id"] && !trace.business_domain) {
    throw new Error("trace requires bkn.tenant.id or business_domain");
  }
  if (!trace["bkn.account.id"] || !trace["bkn.account.type"]) {
    throw new Error("trace requires account id and type");
  }
  if (!/^[0-9a-f]{16}$/.test(options.spanId)) throw new Error("spanId must be 16 hex characters");
  if (!options.producerModule.trim()) throw new Error("producerModule is required");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertSafePayload(
  eventType: BusinessEvidenceEventType,
  payload: Record<string, unknown>,
): void {
  const allowed = PAYLOAD_FIELDS[eventType];
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw new Error(`${eventType} payload field is not registered: ${key}`);
  }
  for (const key of REQUIRED_PAYLOAD_FIELDS[eventType] ?? []) {
    if (payload[key] === undefined || payload[key] === "") {
      throw new Error(`${eventType} payload requires ${key}`);
    }
  }
  if (eventType === "agent.interaction.started" && !payload.agent_id && !payload.app_ref) {
    throw new Error("agent.interaction.started requires agent_id or app_ref");
  }
  if (eventType === "agent.interaction.started") {
    assertEnum(payload, "mode", ["chat", "task", "background"]);
  }
  if (eventType === "model.call.observed" || eventType === "action.executed") {
    assertEnum(payload, "status", ["ok", "error"]);
  }
  if (eventType === "model.call.observed" && payload.status === "error") {
    for (const key of ["error_category", "error_hash"]) {
      if (!payload[key]) throw new Error(`model.call.observed error requires ${key}`);
    }
  }
  if (eventType === "tool.result.observed") {
    assertEnum(payload, "status", ["success", "error"]);
    if (payload.status === "success" && !payload.result_hash) {
      throw new Error("tool.result.observed success requires result_hash");
    }
    if (payload.status === "error" && !payload.error_hash) {
      throw new Error("tool.result.observed error requires error_hash");
    }
  }
  if (eventType === "business.refs.resolved") {
    assertEnum(payload, "resolver_status", ["resolved", "partial", "unresolved"]);
  }
  for (const key of ["source_event_ids", "operation_ids", "target_refs"] as const) {
    if (key in payload && (!Array.isArray(payload[key]) || payload[key].length === 0)) {
      throw new Error(`${eventType} payload requires non-empty ${key}`);
    }
  }
  if (eventType === "evidence.refs.created") {
    assertRefs(payload.evidence_refs, false);
  }
  if (eventType === "business.refs.resolved") {
    const unresolved = payload.resolver_status === "unresolved";
    assertRefs(payload.business_refs, unresolved);
  }
  if (eventType === "action.result_recorded" && !payload.task_ref && !payload.artifact_ref) {
    throw new Error("action.result_recorded requires task_ref or artifact_ref");
  }
  if (eventType === "action.executed" && payload.status === "error") {
    for (const key of ["error_category", "error_hash"]) {
      if (!payload[key]) throw new Error(`action.executed error requires ${key}`);
    }
  }
  const fixedStatus: Partial<Record<BusinessEvidenceEventType, string>> = {
    "action.recommended": "recommended",
    "action.approval_requested": "approval_requested",
    "action.approved": "approved",
    "action.rejected": "rejected",
  };
  if (fixedStatus[eventType] && payload.status !== fixedStatus[eventType]) {
    throw new Error(`${eventType} requires status=${fixedStatus[eventType]}`);
  }
  scanSafeValue(payload, "payload");
}

function assertRefs(value: unknown, allowEmpty: boolean): void {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error("reference list must be a non-empty array");
  }
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("reference must be an object");
    }
    const ref = item as Record<string, unknown>;
    for (const key of Object.keys(ref)) {
      if (!REF_FIELDS.has(key)) throw new Error(`reference field is not registered: ${key}`);
    }
    for (const key of [
      "ref_id",
      "ref_type",
      "source_system",
      "validity",
      "version_status",
      "visibility",
    ]) {
      if (!ref[key]) throw new Error(`reference requires ${key}`);
    }
    assertEnum(ref, "validity", ["observed", "available", "unavailable", "expired", "partial"]);
    assertEnum(ref, "version_status", ["versioned", "unversioned", "not_auditable"]);
    assertEnum(ref, "visibility", [
      "visible",
      "redacted",
      "hidden",
      "omitted",
      "unresolved",
      "unauthorized",
    ]);
  }
}

function assertEnum(value: Record<string, unknown>, key: string, allowed: string[]): void {
  if (!allowed.includes(String(value[key]))) {
    throw new Error(`${key} must be one of ${allowed.join(", ")}`);
  }
}

function scanSafeValue(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => scanSafeValue(child, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (RAW_KEYS.has(key.toLowerCase())) throw new Error(`raw sensitive payload field: ${key}`);
      if (key.endsWith("_hash") && child !== "" && !HASH_RE.test(String(child))) {
        throw new Error(`${path}.${key} must be a sha256 hash`);
      }
      scanSafeValue(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && RAW_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`raw sensitive payload value at ${path}`);
  }
}

export class TraceSession {
  readonly interactionId: string;
  private readonly trace: EvidenceTraceContext;
  private readonly producerModule: string;
  private readonly spanId: string;
  private readonly emit: EvidenceEmitter;
  private readonly idFactory: IDFactory;
  private readonly now: () => string;
  private readonly events: EvidenceEvent[] = [];
  private readonly eventIDs = new Set<string>();
  private readonly operationIDs = new Set<string>();
  private readonly claimEventIDs = new Map<string, string>();
  private readonly actions = new WeakMap<ActionHandle, InternalAction>();
  private flushTail: Promise<void> = Promise.resolve();

  constructor(options: TraceSessionOptions) {
    assertSessionOptions(options);
    this.trace = clone(options.trace);
    this.producerModule = options.producerModule;
    this.spanId = options.spanId;
    this.emit = options.emit;
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? defaultNow;
    this.interactionId = options.interactionId ?? this.idFactory();
  }

  startInteraction(input: InteractionInput): EvidenceEvent {
    return this.append("agent.interaction.started", {
      operationName: input.operationName,
      payload: {
        intent_hash: input.intentHash,
        mode: input.mode,
        ...(input.agentId ? { agent_id: input.agentId } : {}),
        ...(input.appRef ? { app_ref: input.appRef } : {}),
      },
    });
  }

  observeOperation<T extends OperationEventType>(
    eventType: T,
    input: OperationInput<T>,
  ): EvidenceEvent {
    const operationId = input.operationId ?? this.idFactory();
    this.operationIDs.add(operationId);
    return this.append(eventType, { ...input, operationId });
  }

  createClaim(input: ClaimInput): EvidenceEvent {
    if (input.sourceEventIds.length === 0 || input.operationIds.length === 0) {
      throw new Error("claim requires at least one source event and operation");
    }
    this.assertKnownRefs(input.sourceEventIds, this.eventIDs, "event");
    this.assertKnownRefs(input.operationIds, this.operationIDs, "operation");
    const event = this.append("claim.created", {
      operationName: input.operationName,
      causationEventId: input.causationEventId,
      claimId: input.claimId,
      payload: {
        claim_id: input.claimId,
        claim_type: input.claimType,
        claim_hash: input.claimHash,
        source_event_ids: input.sourceEventIds,
        operation_ids: input.operationIds,
        visibility: input.visibility ?? "visible",
        version_status: input.versionStatus ?? "unversioned",
      },
    });
    this.claimEventIDs.set(input.claimId, event.event_id);
    return event;
  }

  createEvidenceRefs(input: EvidenceRefsInput): EvidenceEvent {
    const claimEventID = this.requireClaim(input.claimId);
    if (input.refs.length === 0) throw new Error("evidence refs must not be empty");
    const operationId = this.idFactory();
    this.operationIDs.add(operationId);
    const event = this.append("evidence.refs.created", {
      operationName: input.operationName,
      operationId,
      causationEventId: input.causationEventId ?? claimEventID,
      claimId: input.claimId,
      payload: {
        claim_id: input.claimId,
        evidence_refs: input.refs.map((ref) => ({
          ref_id: ref.refId,
          ref_type: ref.refType,
          source_system: ref.sourceSystem,
          validity: ref.validity,
          version_status: ref.versionStatus,
          visibility: ref.visibility,
          ...(ref.summaryHash ? { summary_hash: ref.summaryHash } : {}),
        })),
      },
    });
    this.claimEventIDs.set(input.claimId, event.event_id);
    return event;
  }

  resolveBusinessRefs(input: BusinessRefsInput): EvidenceEvent {
    const claimEventID = this.requireClaim(input.claimId);
    if (input.resolverStatus === "resolved" && input.refs.length === 0) {
      throw new Error("resolved business refs must not be empty");
    }
    const operationId = this.idFactory();
    this.operationIDs.add(operationId);
    const event = this.append("business.refs.resolved", {
      operationName: input.operationName,
      operationId,
      causationEventId: input.causationEventId ?? claimEventID,
      claimId: input.claimId,
      payload: {
        claim_id: input.claimId,
        resolver_status: input.resolverStatus,
        business_refs: input.refs.map((ref) => ({
          ref_id: ref.refId,
          ref_type: ref.refType,
          source_system: ref.sourceSystem,
          validity: ref.validity,
          version_status: ref.versionStatus,
          visibility: ref.visibility,
        })),
      },
    });
    this.claimEventIDs.set(input.claimId, event.event_id);
    return event;
  }

  recommendAction(input: RecommendActionInput): ActionHandle {
    const claimEventID = this.requireClaim(input.claimId);
    if (input.targetRefs.length === 0) throw new Error("action target refs must not be empty");
    const operationId = this.idFactory();
    const actionInstanceId = this.idFactory();
    this.operationIDs.add(operationId);
    const event = this.append("action.recommended", {
      operationName: input.operationName,
      operationId,
      causationEventId: input.causationEventId ?? claimEventID,
      claimId: input.claimId,
      payload: {
        action_instance_id: actionInstanceId,
        action_type: input.actionType,
        target_refs: input.targetRefs,
        reason_hash: input.reasonHash,
        status: "recommended",
      },
    });
    const internal: InternalAction = {
      actionInstanceId,
      claimId: input.claimId,
      operationId,
      lastEventId: event.event_id,
      state: "recommended",
    };
    const handle = Object.freeze({
      get actionInstanceId() {
        return internal.actionInstanceId;
      },
      get claimId() {
        return internal.claimId;
      },
      get operationId() {
        return internal.operationId;
      },
      get lastEventId() {
        return internal.lastEventId;
      },
      get state() {
        return internal.state;
      },
    });
    this.actions.set(handle, internal);
    return handle;
  }

  requestActionApproval(action: ActionHandle, input: { policyRef: string }): EvidenceEvent {
    const internal = this.expectActionState(action, "recommended");
    const event = this.appendAction(internal, "action.approval_requested", {
      action_instance_id: internal.actionInstanceId,
      policy_ref: input.policyRef,
      status: "approval_requested",
    });
    internal.state = "approval_requested";
    internal.lastEventId = event.event_id;
    return event;
  }

  approveAction(
    action: ActionHandle,
    input: { actorRef: string; policyDecisionRef: string },
  ): EvidenceEvent {
    const internal = this.expectActionState(action, "approval_requested");
    const event = this.appendAction(internal, "action.approved", {
      action_instance_id: internal.actionInstanceId,
      actor_ref: input.actorRef,
      policy_decision_ref: input.policyDecisionRef,
      status: "approved",
    });
    internal.state = "approved";
    internal.lastEventId = event.event_id;
    return event;
  }

  rejectAction(
    action: ActionHandle,
    input: { actorRef: string; policyDecisionRef: string },
  ): EvidenceEvent {
    const internal = this.expectActionState(action, "approval_requested");
    const event = this.appendAction(internal, "action.rejected", {
      action_instance_id: internal.actionInstanceId,
      actor_ref: input.actorRef,
      policy_decision_ref: input.policyDecisionRef,
      status: "rejected",
    });
    internal.state = "rejected";
    internal.lastEventId = event.event_id;
    return event;
  }

  executeAction(action: ActionHandle, input: ExecuteActionInput): EvidenceEvent {
    const internal = this.expectActionState(
      action,
      "approved",
      "requires approval before execution",
    );
    const event = this.appendAction(internal, "action.executed", {
      action_instance_id: internal.actionInstanceId,
      status: input.status,
      invocation_ref: input.invocationRef,
      ...(input.status === "error"
        ? { error_category: input.errorCategory, error_hash: input.errorHash }
        : {}),
    });
    internal.state = "executed";
    internal.lastEventId = event.event_id;
    return event;
  }

  recordActionResult(action: ActionHandle, input: ActionResultInput): EvidenceEvent {
    const internal = this.expectActionState(action, "executed");
    const event = this.appendAction(internal, "action.result_recorded", {
      action_instance_id: internal.actionInstanceId,
      result_hash: input.resultHash,
      status: input.status,
      ...(input.taskRef ? { task_ref: input.taskRef } : {}),
      ...(input.artifactRef ? { artifact_ref: input.artifactRef } : {}),
    });
    internal.state = "result_recorded";
    internal.lastEventId = event.event_id;
    return event;
  }

  pendingEvents(): EvidenceEvent[] {
    return clone(this.events);
  }

  flush(): Promise<EvidenceIngestResponse | undefined> {
    const requestedIDs = new Set(this.events.map((event) => event.event_id));
    const operation = this.flushTail.then(() => this.flushEvents(requestedIDs));
    this.flushTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private appendAction(
    action: InternalAction,
    eventType: BusinessEvidenceEventType,
    payload: Record<string, unknown>,
  ): EvidenceEvent {
    return this.append(eventType, {
      operationName: eventType,
      operationId: action.operationId,
      causationEventId: action.lastEventId,
      claimId: action.claimId,
      payload,
    });
  }

  private append(
    eventType: BusinessEvidenceEventType,
    input: {
      operationName: string;
      operationId?: string;
      causationEventId?: string;
      claimId?: string;
      attempt?: number;
      payload: Record<string, unknown>;
    },
  ): EvidenceEvent {
    assertSafePayload(eventType, input.payload);
    if (eventType !== "agent.interaction.started") {
      if (!input.causationEventId) throw new Error(`${eventType} requires causation_event_id`);
      if (!this.eventIDs.has(input.causationEventId)) {
        throw new Error(`unknown event reference: ${input.causationEventId}`);
      }
    }
    if (
      eventType !== "agent.interaction.started" &&
      eventType !== "claim.created" &&
      !input.operationId
    ) {
      throw new Error(`${eventType} requires operation_id`);
    }
    const eventID = this.idFactory();
    if (this.eventIDs.has(eventID)) throw new Error(`duplicate event id: ${eventID}`);
    const timestamp = this.now();
    const event: EvidenceEvent = {
      event_id: eventID,
      event_type: eventType,
      "bkn.trace.schema.version": "2.1.0",
      observed_at: timestamp,
      emitted_at: timestamp,
      producer_module: this.producerModule,
      trace_id: this.trace.trace_id,
      span_id: this.spanId,
      "bkn.request.id": this.trace["bkn.request.id"],
      "bkn.operation.name": input.operationName,
      interaction_id: this.interactionId,
      ...(input.operationId ? { operation_id: input.operationId } : {}),
      ...(input.causationEventId ? { causation_event_id: input.causationEventId } : {}),
      ...(input.claimId ? { claim_id: input.claimId } : {}),
      ...(input.attempt ? { attempt: input.attempt } : {}),
      payload: clone(input.payload),
    };
    this.events.push(clone(event));
    this.eventIDs.add(eventID);
    return clone(event);
  }

  private async flushEvents(
    requestedIDs: Set<string>,
  ): Promise<EvidenceIngestResponse | undefined> {
    const batch = this.events.filter((event) => requestedIDs.has(event.event_id));
    if (batch.length === 0) return undefined;
    const response = await this.emit({
      "bkn.trace.schema.version": "2.1.0",
      trace: clone(this.trace),
      events: clone(batch),
    });
    const remaining = this.events.filter((event) => !requestedIDs.has(event.event_id));
    this.events.splice(0, this.events.length, ...remaining);
    return response;
  }

  private assertKnownRefs(values: string[], known: Set<string>, kind: string): void {
    for (const value of values) {
      if (!known.has(value)) throw new Error(`unknown ${kind} reference: ${value}`);
    }
  }

  private requireClaim(claimID: string): string {
    const eventID = this.claimEventIDs.get(claimID);
    if (!eventID) throw new Error(`unknown claim reference: ${claimID}`);
    return eventID;
  }

  private expectActionState(
    action: ActionHandle,
    expected: ActionHandle["state"],
    message?: string,
  ): InternalAction {
    const internal = this.actions.get(action);
    if (!internal) throw new Error("action handle does not belong to this trace session");
    if (internal.state !== expected) {
      if (message) throw new Error(`action ${internal.actionInstanceId} ${message}`);
      throw new Error(
        `action ${internal.actionInstanceId} must be ${expected}, got ${internal.state}`,
      );
    }
    return internal;
  }
}
