// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { InputError } from "./errors.js";

// This is the dedicated query_object_instance wrapper's argument contract. The
// generic tool-call path deliberately remains open to deploy-specific tools.
const QUERY_KEYS = new Set([
  "kn_id",
  "ot_id",
  "include_logic_params",
  "response_format",
  "condition",
  "filters",
  "limit",
  "sort",
  "cursor",
  "offset",
  "properties",
  "bkn_context",
]);

const CONDITION_KEYS = new Set([
  "field",
  "operation",
  "sub_conditions",
  "value_from",
  "value",
  "limit_key",
  "limit_value",
]);
const FILTER_KEYS = new Set(["field", "op", "value"]);
const SORT_KEYS = new Set(["field", "direction"]);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkCondition(value: unknown, path: string): void {
  if (!object(value)) throw new InputError(`${path} must be a JSON object`);
  for (const key of Object.keys(value)) {
    if (key === "conditions") {
      throw new InputError(`${path}.conditions is not supported; use ${path}.sub_conditions`);
    }
    if (!CONDITION_KEYS.has(key)) {
      throw new InputError(`Unknown ${path} argument ${key}; check query-object-instance --schema`);
    }
  }
  if (typeof value.operation !== "string" || !value.operation) {
    throw new InputError(`${path}.operation is required`);
  }
  if (value.sub_conditions !== undefined) {
    if (!Array.isArray(value.sub_conditions)) {
      throw new InputError(`${path}.sub_conditions must be a JSON array`);
    }
    value.sub_conditions.forEach((child, index) =>
      checkCondition(child, `${path}.sub_conditions[${index}]`),
    );
  }
}

function checkFilters(value: unknown): void {
  if (!Array.isArray(value)) throw new InputError("filters must be a JSON array");
  value.forEach((filter, index) => {
    const path = `filters[${index}]`;
    if (!object(filter)) throw new InputError(`${path} must be a JSON object`);
    for (const key of Object.keys(filter)) {
      if (!FILTER_KEYS.has(key)) {
        throw new InputError(
          `Unknown ${path} argument ${key}; check query-object-instance --schema`,
        );
      }
    }
    if (typeof filter.field !== "string" || !filter.field) {
      throw new InputError(`${path}.field is required`);
    }
    if (typeof filter.op !== "string" || !filter.op) {
      throw new InputError(`${path}.op is required`);
    }
    if (!Object.hasOwn(filter, "value") || filter.value === undefined) {
      throw new InputError(`${path}.value is required`);
    }
  });
}

function checkSort(value: unknown): void {
  if (!Array.isArray(value)) throw new InputError("sort must be a JSON array");
  value.forEach((item, index) => {
    const path = `sort[${index}]`;
    if (!object(item)) throw new InputError(`${path} must be a JSON object`);
    for (const key of Object.keys(item)) {
      if (!SORT_KEYS.has(key)) {
        throw new InputError(
          `Unknown ${path} argument ${key}; check query-object-instance --schema`,
        );
      }
    }
    if (typeof item.field !== "string" || !item.field) {
      throw new InputError(`${path}.field is required`);
    }
    if (item.direction !== "asc" && item.direction !== "desc") {
      throw new InputError(`${path}.direction must be asc or desc`);
    }
  });
}

/** Reject argument mistakes that the MCP tool can otherwise silently ignore. */
export function validateQueryObjectInstanceArgs(args: Record<string, unknown>): void {
  if (!object(args)) throw new InputError("query-object-instance --args must be a JSON object");
  for (const key of Object.keys(args)) {
    if (key === "knn") {
      throw new InputError(
        "Unknown query_object_instance argument knn; put vector search in condition.operation=knn",
      );
    }
    if (!QUERY_KEYS.has(key)) {
      throw new InputError(
        `Unknown query_object_instance argument ${key}; check query-object-instance --schema`,
      );
    }
  }
  if (typeof args.ot_id !== "string" || !args.ot_id) {
    throw new InputError("query-object-instance requires a non-empty ot_id in --args");
  }
  if (args.condition !== undefined) checkCondition(args.condition, "condition");
  if (args.filters !== undefined) checkFilters(args.filters);
  if (args.sort !== undefined) checkSort(args.sort);
  if (
    args.properties !== undefined &&
    (!Array.isArray(args.properties) || !args.properties.every((name) => typeof name === "string"))
  ) {
    throw new InputError(
      "query-object-instance properties must be an array of field names; use context object-types to find valid names",
    );
  }
}
