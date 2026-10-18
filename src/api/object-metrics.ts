// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { z } from "zod";
import type { RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { request } from "./http.js";

const BACKEND = "/api/bkn-backend/v1/knowledge-networks";
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

export function trialObjectMetric(
  ctx: RequestContext,
  knId: string,
  trial: { definition: unknown; query: unknown },
  opts: ObjectMetricOptions = {},
): Promise<unknown> {
  return request(ctx, `${collection(knId, QUERY)}/trial`, {
    method: "POST",
    query: { branch: opts.branch },
    body: trial,
    responseParser: parseBigIntJSON,
  });
}

export function queryObjectMetric(
  ctx: RequestContext,
  knId: string,
  metricId: string,
  queryBody: unknown,
  opts: ObjectMetricVersionOptions,
): Promise<unknown> {
  return request(ctx, `${collection(knId, QUERY)}/${encodeURIComponent(metricId)}/data`, {
    method: "POST",
    query: { branch: opts.branch, version: requiredVersion(opts.version) },
    body: queryBody,
    responseParser: parseBigIntJSON,
  });
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
