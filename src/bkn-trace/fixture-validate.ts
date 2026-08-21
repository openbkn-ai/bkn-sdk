// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseBigIntJSON } from "../utils/json-bigint.js";

const CONTRACT_VERSIONS = new Set(["1.0.0", "2.0.0", "2.1.0"]);
const BUSINESS_CONTRACT_VERSION = "2.1.0";
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
const REQUEST_ID_RE = /^req_[0-9A-Za-z_.-]+$/;
const RFC3339_NANO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ALLOWED_BAGGAGE = new Set(["bkn.account.type", "bkn.runtime.env"]);
const REQUIRED_LOG_FIELDS = [
  "trace_id",
  "span_id",
  "bkn.request.id",
  "bkn.module.name",
  "bkn.operation.name",
  "bkn.status",
  "bkn.timestamp",
  "bkn.trace.schema.version",
];
const REQUIRED_SPAN_FIELDS = [
  "span_id",
  "name",
  "bkn.module.name",
  "bkn.operation.name",
  "bkn.status",
  "bkn.timestamp",
];
const REQUIRED_EVENT_FIELDS = [
  "trace_id",
  "span_id",
  "bkn.request.id",
  "bkn.operation.name",
  "event_id",
  "event_type",
  "bkn.trace.schema.version",
  "observed_at",
  "emitted_at",
  "producer_module",
  "payload",
];
const SENSITIVE_PATTERNS = [
  /authorization/i,
  /bearer\s+[A-Za-z0-9._-]+/i,
  /access[_-]?token/i,
  /api[_-]?key/i,
  /cookie/i,
  /\bselect\s+.+\s+from\b/is,
  /prompt\s*[:=]/i,
  /https?:\/\/[^\s"']+/i,
  /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/,
];
const BUSINESS_EVENT_TYPES = new Set([
  "agent.interaction.started",
  "retrieval.completed",
  "knowledge.read.observed",
  "data.query.observed",
  "model.call.observed",
  "tool.called",
  "tool.result.observed",
  "claim.created",
  "evidence.refs.created",
  "business.refs.resolved",
  "action.recommended",
  "action.approval_requested",
  "action.approved",
  "action.rejected",
  "action.executed",
  "action.result_recorded",
]);
const CLAIM_EVENT_TYPES = new Set([
  "claim.created",
  "evidence.refs.created",
  "business.refs.resolved",
  "action.recommended",
  "action.approval_requested",
  "action.approved",
  "action.rejected",
  "action.executed",
  "action.result_recorded",
]);
const ACTION_TRANSITIONS: Record<string, Set<string>> = {
  recommended: new Set(["approval_requested"]),
  approval_requested: new Set(["approved", "rejected"]),
  approved: new Set(["executed"]),
  executed: new Set(["result_recorded"]),
  rejected: new Set(),
  result_recorded: new Set(),
};
const ACTION_STATE_BY_EVENT: Record<string, string> = {
  "action.recommended": "recommended",
  "action.approval_requested": "approval_requested",
  "action.approved": "approved",
  "action.rejected": "rejected",
  "action.executed": "executed",
  "action.result_recorded": "result_recorded",
};
interface FixtureActionState {
  state: string;
  claimID: string;
  operationID: string;
  lastEventID: string;
}
const EVENT_PAYLOAD_FIELDS: Record<string, Set<string>> = {
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
    "invocation_ref",
    "tool_ref",
    "status",
    "error_category",
    "error_hash",
  ]),
  "action.result_recorded": new Set([
    "action_instance_id",
    "result_hash",
    "artifact_ref",
    "task_ref",
    "status",
  ]),
};
const REFERENCE_FIELDS = new Set([
  "ref_id",
  "ref_type",
  "source_system",
  "validity",
  "version_status",
  "visibility",
  "summary_hash",
]);
const FORBIDDEN_RAW_KEYS = new Set([
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

export interface FixtureValidationError {
  code: string;
  path: string;
  message: string;
}

export interface FixtureValidationResult {
  fixtureId: string;
  result: "pass" | "fail";
  contractVersion: string | null;
  errors: FixtureValidationError[];
  warnings: string[];
  expectedResult: "pass" | "fail" | null;
  expectationMatched: boolean;
}

export interface FixturePathValidationResult {
  ok: boolean;
  results: FixtureValidationResult[];
}

function err(code: string, path: string, message: string): FixtureValidationError {
  return { code, path, message };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(path, name));
}

function validTraceparent(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = TRACEPARENT_RE.exec(value);
  if (!match) return false;
  const [, traceId, spanId] = match;
  return traceId !== "0".repeat(32) && spanId !== "0".repeat(16);
}

function checkRequired(
  item: Record<string, unknown>,
  fields: string[],
  basePath: string,
  errors: FixtureValidationError[],
): void {
  for (const field of fields) {
    if (item[field] === undefined || item[field] === "") {
      errors.push(
        err(
          "BKN_TRACE_REQUIRED_FIELD_MISSING",
          `${basePath}.${field}`,
          `missing required field ${field}`,
        ),
      );
    }
  }
}

function checkTimestamp(value: unknown, path: string, errors: FixtureValidationError[]): void {
  if (typeof value !== "string" || !RFC3339_NANO_RE.test(value)) {
    errors.push(err("BKN_TRACE_INVALID_TIMESTAMP", path, "timestamp must be UTC RFC3339Nano"));
  }
}

function checkSensitive(value: unknown, path: string, errors: FixtureValidationError[]): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => checkSensitive(child, `${path}[${index}]`, errors));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_RAW_KEYS.has(key.toLowerCase())) {
        errors.push(
          err(
            "BKN_TRACE_SENSITIVE_VALUE_LEAKED",
            `${path}.${key}`,
            "raw sensitive field is forbidden",
          ),
        );
      }
      if (
        key.endsWith("_hash") &&
        child !== "" &&
        (typeof child !== "string" || !/^sha256:[0-9a-f]{64}$/.test(child))
      ) {
        errors.push(
          err("BKN_TRACE_REQUIRED_FIELD_MISSING", `${path}.${key}`, `${key} must be a sha256 hash`),
        );
      }
      checkSensitive(child, `${path}.${key}`, errors);
    }
    return;
  }
  if (typeof value !== "string") return;
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(value))) {
    errors.push(
      err(
        "BKN_TRACE_SENSITIVE_VALUE_LEAKED",
        path,
        "sensitive value must be redacted, hashed, or referenced",
      ),
    );
  }
}

export function validateFixture(data: unknown): FixtureValidationResult {
  const root = asRecord(data);
  const errors: FixtureValidationError[] = [];
  const fixtureId = typeof root.fixture_id === "string" ? root.fixture_id : "<unknown>";
  const contractVersion =
    typeof root["bkn.trace.schema.version"] === "string" ? root["bkn.trace.schema.version"] : null;

  if (!contractVersion) {
    errors.push(
      err(
        "BKN_TRACE_SCHEMA_VERSION_MISSING",
        "$.bkn.trace.schema.version",
        "missing contract version",
      ),
    );
  } else if (!CONTRACT_VERSIONS.has(contractVersion)) {
    errors.push(
      err(
        "BKN_TRACE_SCHEMA_VERSION_UNSUPPORTED",
        "$.bkn.trace.schema.version",
        `unsupported contract version ${contractVersion}`,
      ),
    );
  }

  const trace = asRecord(root.trace);
  const traceId = trace.trace_id;
  const requestId = trace["bkn.request.id"];
  if (typeof traceId !== "string" || !/^[0-9a-f]{32}$/.test(traceId)) {
    errors.push(
      err("BKN_TRACE_REQUIRED_FIELD_MISSING", "$.trace.trace_id", "missing valid trace id"),
    );
  }
  if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) {
    errors.push(
      err(
        "BKN_TRACE_REQUIRED_FIELD_MISSING",
        "$.trace.bkn.request.id",
        "missing valid bkn.request.id",
      ),
    );
  }
  if (!validTraceparent(trace.traceparent)) {
    errors.push(err("BKN_TRACE_INVALID_TRACEPARENT", "$.trace.traceparent", "invalid traceparent"));
  }

  const spans = Array.isArray(root.spans) ? root.spans : [];
  const spanIds = new Set<string>();
  spans.forEach((item, index) => {
    const span = asRecord(item);
    checkRequired(span, REQUIRED_SPAN_FIELDS, `$.spans[${index}]`, errors);
    checkTimestamp(span["bkn.timestamp"], `$.spans[${index}].bkn.timestamp`, errors);
    if (typeof span.span_id === "string") spanIds.add(span.span_id);
    const parent = span.parent_span_id;
    if (parent !== null && parent !== undefined && !spanIds.has(String(parent))) {
      errors.push(
        err(
          "BKN_TRACE_ORPHAN_SPAN",
          `$.spans[${index}].parent_span_id`,
          "parent span must appear before child span or be represented as a link",
        ),
      );
    }
  });
  if (spans.length === 0) {
    errors.push(err("BKN_TRACE_REQUIRED_FIELD_MISSING", "$.spans", "at least one span required"));
  }

  const logs = Array.isArray(root.logs) ? root.logs : [];
  logs.forEach((item, index) => {
    const log = asRecord(item);
    checkRequired(log, REQUIRED_LOG_FIELDS, `$.logs[${index}]`, errors);
    checkTimestamp(log["bkn.timestamp"], `$.logs[${index}].bkn.timestamp`, errors);
    if (log.trace_id !== traceId || log["bkn.request.id"] !== requestId) {
      errors.push(
        err("BKN_TRACE_JOIN_FAILED", `$.logs[${index}]`, "log cannot join trace/request"),
      );
    }
    if (!spanIds.has(String(log.span_id))) {
      errors.push(
        err("BKN_TRACE_JOIN_FAILED", `$.logs[${index}].span_id`, "log span_id not found"),
      );
    }
  });

  const events = Array.isArray(root.events) ? root.events : [];
  const eventIds = new Set<string>();
  const knownEventIds = new Set<string>();
  const knownOperationIds = new Set<string>();
  const knownClaimIds = new Set<string>();
  const actionStates = new Map<string, FixtureActionState>();
  events.forEach((item, index) => {
    const event = asRecord(item);
    const eventPath = `$.events[${index}]`;
    checkRequired(event, REQUIRED_EVENT_FIELDS, `$.events[${index}]`, errors);
    checkTimestamp(event.observed_at, `$.events[${index}].observed_at`, errors);
    checkTimestamp(event.emitted_at, `$.events[${index}].emitted_at`, errors);
    if (event.trace_id !== traceId || event["bkn.request.id"] !== requestId) {
      errors.push(
        err("BKN_TRACE_JOIN_FAILED", `$.events[${index}]`, "event cannot join trace/request"),
      );
    }
    if (!spanIds.has(String(event.span_id))) {
      errors.push(
        err("BKN_TRACE_JOIN_FAILED", `$.events[${index}].span_id`, "event span_id not found"),
      );
    }
    if (typeof event.event_id === "string") {
      if (eventIds.has(event.event_id)) {
        errors.push(
          err("BKN_TRACE_EVENT_ID_CONFLICT", `${eventPath}.event_id`, "duplicate event_id"),
        );
      }
      eventIds.add(event.event_id);
    }
    if (contractVersion !== BUSINESS_CONTRACT_VERSION) return;
    if (event["bkn.trace.schema.version"] !== contractVersion) {
      errors.push(
        err(
          "BKN_TRACE_SCHEMA_VERSION_UNSUPPORTED",
          `${eventPath}.bkn.trace.schema.version`,
          "event contract version must match the fixture envelope",
        ),
      );
    }
    validateBusinessEvent(
      event,
      eventPath,
      knownEventIds,
      knownOperationIds,
      knownClaimIds,
      actionStates,
      errors,
    );
    if (typeof event.event_id === "string") knownEventIds.add(event.event_id);
    if (typeof event.operation_id === "string") knownOperationIds.add(event.operation_id);
    if (event.event_type === "claim.created" && typeof event.claim_id === "string") {
      knownClaimIds.add(event.claim_id);
    }
  });
  if (contractVersion !== "1.0.0" && events.length === 0) {
    errors.push(err("BKN_TRACE_REQUIRED_FIELD_MISSING", "$.events", "at least one event required"));
  }

  const baggage = asRecord(root.baggage);
  for (const key of Object.keys(baggage)) {
    if (!ALLOWED_BAGGAGE.has(key)) {
      errors.push(
        err(
          "BKN_TRACE_BAGGAGE_FORBIDDEN_FIELD",
          `$.baggage.${key}`,
          `baggage field ${key} is forbidden`,
        ),
      );
    }
  }

  checkSensitive(root, "$", errors);
  const result: "pass" | "fail" = errors.length > 0 ? "fail" : "pass";
  const expectedResult =
    root.expected_result === "pass" || root.expected_result === "fail"
      ? root.expected_result
      : null;
  return {
    fixtureId,
    result,
    contractVersion,
    errors,
    warnings: [],
    expectedResult,
    expectationMatched: expectedResult === null ? result === "pass" : expectedResult === result,
  };
}

function validateBusinessEvent(
  event: Record<string, unknown>,
  path: string,
  knownEventIds: Set<string>,
  knownOperationIds: Set<string>,
  knownClaimIds: Set<string>,
  actionStates: Map<string, FixtureActionState>,
  errors: FixtureValidationError[],
): void {
  const eventType = typeof event.event_type === "string" ? event.event_type : "";
  if (!BUSINESS_EVENT_TYPES.has(eventType)) {
    errors.push(
      err(
        "BKN_TRACE_EVENT_TYPE_UNSUPPORTED",
        `${path}.event_type`,
        `unsupported event ${eventType}`,
      ),
    );
    return;
  }
  checkRequired(event, ["interaction_id"], path, errors);
  if (eventType !== "agent.interaction.started" && eventType !== "claim.created") {
    checkRequired(event, ["operation_id"], path, errors);
  }
  if (eventType !== "agent.interaction.started") {
    checkRequired(event, ["causation_event_id"], path, errors);
    if (
      typeof event.causation_event_id === "string" &&
      !knownEventIds.has(event.causation_event_id)
    ) {
      errors.push(
        err(
          "BKN_TRACE_CAUSATION_INVALID",
          `${path}.causation_event_id`,
          "causation_event_id must reference an earlier event",
        ),
      );
    }
  }
  if (CLAIM_EVENT_TYPES.has(eventType)) {
    checkRequired(event, ["claim_id"], path, errors);
    if (
      eventType !== "claim.created" &&
      typeof event.claim_id === "string" &&
      !knownClaimIds.has(event.claim_id)
    ) {
      errors.push(
        err(
          "BKN_TRACE_UNKNOWN_CLAIM_ID",
          `${path}.claim_id`,
          "event must reference an earlier claim",
        ),
      );
    }
  }
  const payload = asRecord(event.payload);
  checkAllowedKeys(
    payload,
    EVENT_PAYLOAD_FIELDS[eventType] ?? new Set(),
    `${path}.payload`,
    errors,
  );
  if (eventType === "agent.interaction.started") {
    checkRequired(payload, ["intent_hash", "mode"], `${path}.payload`, errors);
    checkOneOf(payload, ["agent_id", "app_ref"], `${path}.payload`, errors);
  }
  if (eventType === "retrieval.completed") {
    checkRequired(
      payload,
      ["query_hash", "candidate_count", "truncated"],
      `${path}.payload`,
      errors,
    );
  }
  if (eventType === "knowledge.read.observed") {
    checkRequired(payload, ["kn_id", "read_kind", "version_status"], `${path}.payload`, errors);
  }
  if (eventType === "data.query.observed") {
    checkRequired(payload, ["query_hash", "query_type", "row_count"], `${path}.payload`, errors);
  }
  if (eventType === "model.call.observed") {
    checkRequired(
      payload,
      [
        "model_name",
        "model_provider",
        "status",
        "input_token_count",
        "output_token_count",
        "prompt_hash",
        "output_hash",
      ],
      `${path}.payload`,
      errors,
    );
    if (payload.status === "error") {
      checkRequired(payload, ["error_category", "error_hash"], `${path}.payload`, errors);
    }
  }
  if (eventType === "claim.created") {
    checkRequired(
      payload,
      [
        "claim_id",
        "claim_type",
        "claim_hash",
        "source_event_ids",
        "operation_ids",
        "visibility",
        "version_status",
      ],
      `${path}.payload`,
      errors,
    );
    checkNonEmptyArray(payload, "source_event_ids", `${path}.payload`, errors);
    checkNonEmptyArray(payload, "operation_ids", `${path}.payload`, errors);
    checkKnownArray(payload, "source_event_ids", knownEventIds, `${path}.payload`, errors);
    checkKnownArray(payload, "operation_ids", knownOperationIds, `${path}.payload`, errors);
  }
  if (eventType === "evidence.refs.created") {
    checkReferenceList(payload, "evidence_refs", `${path}.payload`, errors);
  }
  if (eventType === "business.refs.resolved") {
    checkRequired(payload, ["resolver_status"], `${path}.payload`, errors);
    checkReferenceList(
      payload,
      "business_refs",
      `${path}.payload`,
      errors,
      payload.resolver_status === "unresolved",
    );
  }
  const actionState = ACTION_STATE_BY_EVENT[eventType];
  if (!actionState) return;
  checkRequired(payload, ["action_instance_id", "status"], `${path}.payload`, errors);
  const fixedStatus: Record<string, string> = {
    "action.recommended": "recommended",
    "action.approval_requested": "approval_requested",
    "action.approved": "approved",
    "action.rejected": "rejected",
  };
  if (fixedStatus[eventType] && payload.status !== fixedStatus[eventType]) {
    errors.push(
      err(
        "BKN_TRACE_ACTION_TRANSITION_INVALID",
        `${path}.payload.status`,
        `${eventType} requires status=${fixedStatus[eventType]}`,
      ),
    );
  }
  if (eventType === "action.recommended") {
    checkRequired(
      payload,
      ["action_type", "target_refs", "reason_hash"],
      `${path}.payload`,
      errors,
    );
    checkNonEmptyArray(payload, "target_refs", `${path}.payload`, errors);
    checkQualifiedStringRefs(payload, "target_refs", `${path}.payload`, errors);
  }
  if (eventType === "action.approval_requested") {
    checkRequired(payload, ["policy_ref"], `${path}.payload`, errors);
  }
  if (eventType === "action.approved" || eventType === "action.rejected") {
    checkRequired(payload, ["actor_ref", "policy_decision_ref"], `${path}.payload`, errors);
  }
  if (eventType === "action.executed") {
    checkOneOf(payload, ["invocation_ref", "tool_ref"], `${path}.payload`, errors);
    if (payload.status === "error") {
      checkRequired(payload, ["error_category", "error_hash"], `${path}.payload`, errors);
    }
  }
  if (eventType === "action.result_recorded") {
    checkRequired(payload, ["result_hash"], `${path}.payload`, errors);
    checkOneOf(payload, ["artifact_ref", "task_ref"], `${path}.payload`, errors);
  }
  const actionID = typeof payload.action_instance_id === "string" ? payload.action_instance_id : "";
  if (!actionID) return;
  const claimID = typeof event.claim_id === "string" ? event.claim_id : "";
  const operationID = typeof event.operation_id === "string" ? event.operation_id : "";
  const previous = actionStates.get(actionID);
  if (
    (!previous && actionState !== "recommended") ||
    (previous &&
      (!ACTION_TRANSITIONS[previous.state]?.has(actionState) ||
        event.causation_event_id !== previous.lastEventID ||
        claimID !== previous.claimID ||
        operationID !== previous.operationID))
  ) {
    errors.push(
      err(
        "BKN_TRACE_ACTION_TRANSITION_INVALID",
        `${path}.event_type`,
        `invalid action transition ${previous?.state ?? "<none>"} -> ${actionState}`,
      ),
    );
    return;
  }
  actionStates.set(actionID, {
    state: actionState,
    claimID,
    operationID,
    lastEventID: String(event.event_id ?? ""),
  });
}

function checkOneOf(
  payload: Record<string, unknown>,
  fields: string[],
  path: string,
  errors: FixtureValidationError[],
): void {
  if (fields.some((field) => typeof payload[field] === "string" && payload[field] !== "")) return;
  errors.push(
    err(
      "BKN_TRACE_REQUIRED_FIELD_MISSING",
      `${path}.${fields[0]}`,
      `one of ${fields.join(" or ")} is required`,
    ),
  );
}

function checkNonEmptyArray(
  payload: Record<string, unknown>,
  field: string,
  path: string,
  errors: FixtureValidationError[],
): void {
  if (Array.isArray(payload[field]) && payload[field].length > 0) return;
  errors.push(
    err(
      "BKN_TRACE_REQUIRED_FIELD_MISSING",
      `${path}.${field}`,
      `${field} must be a non-empty array`,
    ),
  );
}

function checkReferenceList(
  payload: Record<string, unknown>,
  field: string,
  path: string,
  errors: FixtureValidationError[],
  allowEmpty = false,
): void {
  if (!allowEmpty) checkNonEmptyArray(payload, field, path, errors);
  const refs = Array.isArray(payload[field]) ? payload[field] : [];
  refs.forEach((value, index) => {
    const ref = asRecord(value);
    checkRequired(
      ref,
      ["ref_id", "ref_type", "source_system", "validity", "version_status", "visibility"],
      `${path}.${field}[${index}]`,
      errors,
    );
    checkAllowedKeys(ref, REFERENCE_FIELDS, `${path}.${field}[${index}]`, errors);
    if (typeof ref.ref_id === "string" && !isQualifiedReference(ref.ref_id)) {
      errors.push(
        err(
          "BKN_TRACE_REFERENCE_ID_INVALID",
          `${path}.${field}[${index}].ref_id`,
          "business reference id must include its knowledge-network or resource scope",
        ),
      );
    }
  });
}

function checkQualifiedStringRefs(
  payload: Record<string, unknown>,
  field: string,
  path: string,
  errors: FixtureValidationError[],
): void {
  const refs = Array.isArray(payload[field]) ? payload[field] : [];
  refs.forEach((value, index) => {
    if (typeof value !== "string" || isQualifiedReference(value)) return;
    errors.push(
      err(
        "BKN_TRACE_REFERENCE_ID_INVALID",
        `${path}.${field}[${index}]`,
        "business reference id must include its knowledge-network or resource scope",
      ),
    );
  });
}

function isQualifiedReference(value: string): boolean {
  const parts = value.trim().split(":");
  if (parts.some((part) => part.length === 0)) return false;
  if (["kn", "resource"].includes(parts[0] ?? "")) return parts.length === 2;
  if (["object", "relation", "action_type", "metric", "field"].includes(parts[0] ?? "")) {
    return parts.length === 3;
  }
  if (parts[0] === "property") return parts.length === 4;
  return true;
}

function checkKnownArray(
  payload: Record<string, unknown>,
  field: string,
  known: Set<string>,
  path: string,
  errors: FixtureValidationError[],
): void {
  if (!Array.isArray(payload[field])) return;
  for (const value of payload[field]) {
    if (typeof value === "string" && known.has(value)) continue;
    errors.push(
      err(
        "BKN_TRACE_CAUSATION_INVALID",
        `${path}.${field}`,
        `${field} must reference earlier events or operations`,
      ),
    );
  }
}

function checkAllowedKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  errors: FixtureValidationError[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    errors.push(
      err(
        "BKN_TRACE_EVENT_PAYLOAD_FIELD_UNSUPPORTED",
        `${path}.${key}`,
        `payload field ${key} is not registered for this event`,
      ),
    );
  }
}

export function validateFixturePath(path: string): FixturePathValidationResult {
  const results = jsonFiles(path).map((file) => {
    try {
      return validateFixture(parseBigIntJSON(readFileSync(file, "utf8")));
    } catch (e) {
      return {
        fixtureId: file,
        result: "fail" as const,
        contractVersion: null,
        errors: [
          err(
            "BKN_TRACE_FIXTURE_PARSE_FAILED",
            "$",
            `failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`,
          ),
        ],
        warnings: [],
        expectedResult: null,
        expectationMatched: false,
      };
    }
  });
  return { ok: results.every((r) => r.expectationMatched), results };
}
