// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CONTRACT_VERSION = "1.0.0";
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
    for (const [key, child] of Object.entries(value))
      checkSensitive(child, `${path}.${key}`, errors);
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
  } else if (contractVersion !== CONTRACT_VERSION) {
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
  events.forEach((item, index) => {
    const event = asRecord(item);
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
  });

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

export function validateFixturePath(path: string): FixturePathValidationResult {
  const results = jsonFiles(path).map((file) => {
    try {
      return validateFixture(JSON.parse(readFileSync(file, "utf8")));
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
