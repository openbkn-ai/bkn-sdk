// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { z } from "zod";
import type { RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { request } from "./http.js";

const BACKEND_ROOT = "/api/bkn-backend/v1";
const BACKEND = `${BACKEND_ROOT}/knowledge-networks`;
const QUERY = "/api/ontology-query/v1/knowledge-networks";

export interface ObjectMetricOptions {
  branch?: string;
}

export interface ObjectMetricVersionOptions extends ObjectMetricOptions {
  version: number;
}

export interface ListObjectMetricsOptions extends ObjectMetricOptions {
  ownerObjectTypeId?: string;
  metricType?: "atomic" | "derived" | "composite";
  status?: "draft" | "validated" | "published" | "deprecated";
  keyword?: string;
  offset?: number;
  limit?: number;
}

export interface ObjectMetricPropertyRef {
  object_type_id: string;
  property_name: string;
  relation_path_alias?: string;
}

export interface ObjectMetricPropertyOperand {
  source: "property";
  property_ref: ObjectMetricPropertyRef;
}

export interface ObjectMetricLiteralOperand {
  source: "literal";
  value_type: "int64" | "decimal" | "boolean" | "string" | "date" | "datetime" | "duration";
  value: unknown;
}

export type ObjectMetricOperand = ObjectMetricPropertyOperand | ObjectMetricLiteralOperand;

interface ObjectMetricPredicateBase {
  node_type: "predicate";
  left: ObjectMetricOperand;
}

export type ObjectMetricPredicate =
  | (ObjectMetricPredicateBase & {
      comparison_operator:
        | "eq"
        | "neq"
        | "gt"
        | "gte"
        | "lt"
        | "lte"
        | "contains"
        | "not_contains"
        | "starts_with"
        | "ends_with"
        | "before"
        | "before_or_equal"
        | "after"
        | "after_or_equal";
      right: [ObjectMetricOperand];
    })
  | (ObjectMetricPredicateBase & {
      comparison_operator: "in" | "not_in";
      right: [ObjectMetricOperand, ...ObjectMetricOperand[]];
    })
  | (ObjectMetricPredicateBase & {
      comparison_operator: "between" | "not_between";
      right: [ObjectMetricOperand, ObjectMetricOperand];
    })
  | (ObjectMetricPredicateBase & {
      comparison_operator:
        | "is_empty"
        | "is_not_empty"
        | "is_null"
        | "is_not_null"
        | "is_true"
        | "is_false";
      right?: never;
    });

export type ObjectMetricConditionGroup =
  | {
      node_type: "group";
      boolean_operator: "and" | "or";
      children: [ObjectMetricCondition, ObjectMetricCondition, ...ObjectMetricCondition[]];
    }
  | {
      node_type: "group";
      boolean_operator: "not";
      children: [ObjectMetricCondition];
    };

export type ObjectMetricCondition = ObjectMetricPredicate | ObjectMetricConditionGroup;

export interface ObjectMetricTimeRange {
  start: number;
  end: number;
}

export interface ObjectMetricHaving {
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "is_null" | "is_not_null";
  value?: unknown;
  unit_code?: string;
}

export interface ObjectMetricOrderBy {
  field: "value" | "time" | "dimension";
  dimension?: ObjectMetricPropertyRef;
  direction: "asc" | "desc";
}

export interface ObjectMetricQuery {
  instance_identities?: Record<string, unknown>[];
  filter?: ObjectMetricCondition;
  group_by?: ObjectMetricPropertyRef[];
  having?: ObjectMetricHaving;
  order_by?: ObjectMetricOrderBy[];
  page_size?: number;
  cursor?: string;
  time?: ObjectMetricTimeRange;
  bucket_selection?: {
    parent_query: ObjectMetricQuery;
    bucket_key: string;
  };
}

export interface ObjectMetricTrial {
  definition: unknown;
  query: ObjectMetricQuery;
}

export interface ObjectMetricDataEntry {
  instance_identity?: Record<string, unknown>;
  dimensions?: Record<string, unknown>;
  dimension_cells?: Array<{ ref: ObjectMetricPropertyRef; value: unknown }>;
  time?: number;
  time_bucket?: ObjectMetricTimeRange;
  value?: unknown;
  status: "ok" | "no_data" | "unavailable";
  bucket_key?: string;
  available_actions?: string[];
}

export interface ObjectMetricData {
  model: Record<string, unknown>;
  entries: ObjectMetricDataEntry[];
  status: "ok" | "no_data" | "unavailable" | "partial";
  empty_reason?: string;
  next_cursor?: string;
  total_count: number;
  warnings?: string[];
  overall_ms: number;
  evaluated_at: number;
  effective_window?: ObjectMetricTimeRange;
}

export interface ObjectMetricDrillThroughRequest {
  query: ObjectMetricQuery;
  bucket_key: string;
  page_size?: number;
  cursor?: string;
}

export interface ObjectMetricDrillThrough {
  participants: Array<{ instance_identity: Record<string, unknown>; role: string }>;
  next_cursor?: string;
  bucket_value?: unknown;
  evaluated_at: number;
  status: "ok" | "partial";
  warnings?: string[];
}

export interface ObjectMetricLogicPropertyBinding {
  object_type_id: string;
  property_name: string;
  display_name: string;
  comment?: string;
}

const ObjectMetricPropertyRefResult = z
  .object({
    object_type_id: z.string(),
    property_name: z.string(),
    relation_path_alias: z.string().optional(),
  })
  .strict();

const ObjectMetricTimeRangeResult = z
  .object({ start: z.number().int(), end: z.number().int() })
  .strict();

const ObjectMetricDataEntryResult = z
  .object({
    instance_identity: z.record(z.unknown()).optional(),
    dimensions: z.record(z.unknown()).optional(),
    dimension_cells: z
      .array(z.object({ ref: ObjectMetricPropertyRefResult, value: z.unknown() }).strict())
      .optional(),
    time: z.number().int().optional(),
    time_bucket: ObjectMetricTimeRangeResult.optional(),
    value: z.unknown().optional(),
    status: z.enum(["ok", "no_data", "unavailable"]),
    bucket_key: z.string().optional(),
    available_actions: z.array(z.string()).optional(),
  })
  .passthrough();

export const ObjectMetricDataResult = z
  .object({
    model: z.record(z.unknown()),
    entries: z.array(ObjectMetricDataEntryResult),
    status: z.enum(["ok", "no_data", "unavailable", "partial"]),
    empty_reason: z.string().optional(),
    next_cursor: z.string().optional(),
    total_count: z.number().int(),
    warnings: z.array(z.string()).optional(),
    overall_ms: z.number().int(),
    evaluated_at: z.number().int(),
    effective_window: ObjectMetricTimeRangeResult.optional(),
  })
  .passthrough();

export const ObjectMetricDrillThroughResult = z
  .object({
    participants: z.array(
      z.object({ instance_identity: z.record(z.unknown()), role: z.string() }).passthrough(),
    ),
    next_cursor: z.string().optional(),
    bucket_value: z.unknown().optional(),
    evaluated_at: z.number().int(),
    status: z.enum(["ok", "partial"]),
    warnings: z.array(z.string()).optional(),
  })
  .passthrough();

export const ObjectMetricValidationResult = z
  .object({
    valid: z.boolean(),
    issues: z.array(z.object({ code: z.string(), field: z.string(), message: z.string() })),
    output_shape: z.enum(["object_value", "summary", "grouped", "time_series"]),
  })
  .passthrough();
export type ObjectMetricValidationResult = z.infer<typeof ObjectMetricValidationResult>;

function collection(knId: string, backend = BACKEND): string {
  return `${backend}/${encodeURIComponent(knId)}/object-metrics`;
}

function item(knId: string, metricId: string): string {
  return `${collection(knId)}/${encodeURIComponent(metricId)}`;
}

function requiredVersion(version: number): number {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new InputError("Object metric version must be a positive integer.");
  }
  return version;
}

export function listObjectMetrics(
  ctx: RequestContext,
  knId: string,
  opts: ListObjectMetricsOptions = {},
): Promise<unknown> {
  return request(ctx, collection(knId), {
    query: {
      branch: opts.branch,
      owner_object_type_id: opts.ownerObjectTypeId,
      metric_type: opts.metricType,
      status: opts.status,
      keyword: opts.keyword,
      offset: opts.offset,
      limit: opts.limit,
    },
  });
}

export function getObjectMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  opts: ObjectMetricOptions & { version?: number } = {},
): Promise<unknown> {
  return request(ctx, item(knId, metricId), {
    query: {
      branch: opts.branch,
      version: opts.version === undefined ? undefined : requiredVersion(opts.version),
    },
  });
}

export function createObjectMetricDraft(
  ctx: RequestContext,
  knId: string,
  definition: unknown,
  opts: ObjectMetricOptions = {},
): Promise<unknown> {
  return request(ctx, collection(knId), {
    method: "POST",
    query: { branch: opts.branch },
    body: definition,
  });
}

export function updateObjectMetricDraft(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  definition: unknown,
  opts: ObjectMetricVersionOptions,
): Promise<unknown> {
  const version = requiredVersion(opts.version);
  if (
    definition === null ||
    typeof definition !== "object" ||
    Array.isArray(definition) ||
    (definition as Record<string, unknown>).version !== version
  ) {
    throw new InputError("Object metric definition.version must match --metric-version.");
  }
  return request(ctx, item(knId, metricId), {
    method: "PUT",
    query: { branch: opts.branch, version },
    body: definition,
  });
}

export function deleteObjectMetricDraft(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  opts: ObjectMetricVersionOptions,
): Promise<unknown> {
  return request(ctx, item(knId, metricId), {
    method: "DELETE",
    query: { branch: opts.branch, version: requiredVersion(opts.version) },
  });
}

export async function validateObjectMetric(
  ctx: RequestContext,
  knId: string,
  definition: unknown,
  opts: ObjectMetricOptions = {},
): Promise<ObjectMetricValidationResult> {
  const result = await request<unknown>(ctx, `${collection(knId)}/validate`, {
    method: "POST",
    query: { branch: opts.branch },
    body: definition,
  });
  return ObjectMetricValidationResult.parse(result);
}

export async function trialObjectMetric(
  ctx: RequestContext,
  knId: string,
  trial: ObjectMetricTrial,
  opts: ObjectMetricOptions = {},
): Promise<ObjectMetricData> {
  const result = await request<unknown>(ctx, `${collection(knId, QUERY)}/trial`, {
    method: "POST",
    query: { branch: opts.branch },
    body: trial,
    responseParser: parseBigIntJSON,
  });
  return ObjectMetricDataResult.parse(result) as ObjectMetricData;
}

export function queryObjectMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  queryBody: ObjectMetricQuery,
  opts: ObjectMetricVersionOptions,
): Promise<ObjectMetricData> {
  const version = requiredVersion(opts.version);
  return request<unknown>(ctx, `${collection(knId, QUERY)}/${encodeURIComponent(metricId)}/data`, {
    method: "POST",
    query: { branch: opts.branch, version },
    body: queryBody,
    responseParser: parseBigIntJSON,
  }).then((result) => ObjectMetricDataResult.parse(result) as ObjectMetricData);
}

export function getObjectMetricCapabilities(ctx: RequestContext): Promise<unknown> {
  return request(ctx, `${BACKEND_ROOT}/object-metrics/capabilities`);
}

export function previewObjectMetric(
  ctx: RequestContext,
  knId: string,
  definition: unknown,
  opts: ObjectMetricOptions = {},
): Promise<unknown> {
  return request(ctx, `${collection(knId)}/preview`, {
    method: "POST",
    query: { branch: opts.branch },
    body: definition,
  });
}

export function checkObjectMetricDeletion(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  opts: ObjectMetricVersionOptions,
): Promise<unknown> {
  return request(ctx, `${item(knId, metricId)}/deletion-check`, {
    query: { branch: opts.branch, version: requiredVersion(opts.version) },
  });
}

export function bindObjectMetricLogicProperty(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  binding: ObjectMetricLogicPropertyBinding,
  opts: ObjectMetricVersionOptions,
): Promise<unknown> {
  return request(ctx, `${item(knId, metricId)}/logic-properties`, {
    method: "POST",
    query: { branch: opts.branch, version: requiredVersion(opts.version) },
    body: binding,
  });
}

export function upgradeObjectMetricLogicProperty(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  propertyName: string,
  opts: ObjectMetricVersionOptions,
): Promise<unknown> {
  return request(
    ctx,
    `${item(knId, metricId)}/logic-properties/${encodeURIComponent(propertyName)}/metric-ref`,
    {
      method: "PUT",
      query: { branch: opts.branch, version: requiredVersion(opts.version) },
    },
  );
}

export function drillThroughObjectMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  body: ObjectMetricDrillThroughRequest,
  opts: ObjectMetricVersionOptions,
): Promise<ObjectMetricDrillThrough> {
  const version = requiredVersion(opts.version);
  return request<unknown>(
    ctx,
    `${collection(knId, QUERY)}/${encodeURIComponent(metricId)}/data/drill-through`,
    {
      method: "POST",
      query: { branch: opts.branch, version },
      body,
      responseParser: parseBigIntJSON,
    },
  ).then((result) => ObjectMetricDrillThroughResult.parse(result) as ObjectMetricDrillThrough);
}

export async function drillThroughObjectMetricTrial(
  ctx: RequestContext,
  knId: string,
  body: ObjectMetricDrillThroughRequest & { definition: unknown },
  opts: ObjectMetricOptions = {},
): Promise<ObjectMetricDrillThrough> {
  const result = await request<unknown>(ctx, `${collection(knId, QUERY)}/trial/drill-through`, {
    method: "POST",
    query: { branch: opts.branch },
    body,
    responseParser: parseBigIntJSON,
  });
  return ObjectMetricDrillThroughResult.parse(result) as ObjectMetricDrillThrough;
}

export function listObjectMetricVersions(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  opts: ObjectMetricOptions = {},
): Promise<unknown> {
  return request(ctx, `${item(knId, metricId)}/versions`, { query: { branch: opts.branch } });
}

export function createNextObjectMetricDraftVersion(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  opts: ObjectMetricOptions = {},
): Promise<unknown> {
  return request(ctx, `${item(knId, metricId)}/versions`, {
    method: "POST",
    query: { branch: opts.branch },
  });
}

function versionAction(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  action: "validate" | "publish" | "deprecate",
  opts: ObjectMetricVersionOptions,
): Promise<unknown> {
  return request(ctx, `${item(knId, metricId)}/${action}`, {
    method: "POST",
    query: { branch: opts.branch, version: requiredVersion(opts.version) },
  });
}

export function validateSavedObjectMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  opts: ObjectMetricVersionOptions,
): Promise<unknown> {
  return versionAction(ctx, knId, metricId, "validate", opts);
}

export function publishObjectMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  opts: ObjectMetricVersionOptions,
): Promise<unknown> {
  return versionAction(ctx, knId, metricId, "publish", opts);
}

export function deprecateObjectMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  opts: ObjectMetricVersionOptions,
): Promise<unknown> {
  return versionAction(ctx, knId, metricId, "deprecate", opts);
}
