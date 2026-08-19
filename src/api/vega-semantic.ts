// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Vega semantic-understanding task lifecycle APIs. */
import { z } from "zod";
import { DEFAULT_LIST_LIMIT, type RequestContext } from "../types.js";
import { request } from "./http.js";
import { VegaAccountInfo, type VegaTaskStatus } from "./vega-discovery.js";

const BASE = "/api/vega-backend/v1/semantic-understanding-tasks";

export const SemanticUnderstandingScope = z.enum(["resource", "catalog"]);
export type SemanticUnderstandingScope = z.infer<typeof SemanticUnderstandingScope>;

export const SemanticUnderstandingApplyMode = z.enum(["dry_run", "fill_empty", "force"]);
export type SemanticUnderstandingApplyMode = z.infer<typeof SemanticUnderstandingApplyMode>;

export const SemanticUnderstandingTaskSort = z.enum(["create_time", "start_time", "finish_time"]);
export type SemanticUnderstandingTaskSort = z.infer<typeof SemanticUnderstandingTaskSort>;

export const SemanticUnderstandingTask = z
  .object({
    id: z.string(),
    scope: z.string(),
    catalog_id: z.string(),
    catalog_name: z.string().optional(),
    resource_id: z.string().optional(),
    resource_name: z.string().optional(),
    agent_task_id: z.string().optional(),
    agent_id: z.string(),
    input: z.string(),
    input_hash: z.string(),
    status: z.string(),
    apply_mode: z.string(),
    result_json: z.string().optional(),
    confidence_threshold: z.number(),
    confidence: z.number(),
    confidence_detail_json: z.string().optional(),
    apply_detail_json: z.string().optional(),
    applied: z.boolean(),
    failure_detail: z.string().optional(),
    creator: VegaAccountInfo,
    create_time: z.number(),
    start_time: z.number().optional(),
    finish_time: z.number().optional(),
  })
  .passthrough();
export type SemanticUnderstandingTask = z.infer<typeof SemanticUnderstandingTask>;

export const SemanticUnderstandingTaskSummary = SemanticUnderstandingTask.omit({
  input: true,
  input_hash: true,
  result_json: true,
  confidence_detail_json: true,
  apply_detail_json: true,
  failure_detail: true,
});
export type SemanticUnderstandingTaskSummary = z.infer<typeof SemanticUnderstandingTaskSummary>;

export const ListSemanticUnderstandingTasksResponse = z
  .object({ entries: z.array(SemanticUnderstandingTaskSummary), total_count: z.number() })
  .passthrough();
export type ListSemanticUnderstandingTasksResponse = z.infer<
  typeof ListSemanticUnderstandingTasksResponse
>;

interface CreateSemanticUnderstandingTaskBase {
  applyMode?: SemanticUnderstandingApplyMode;
  confidenceThreshold?: number;
}

export type CreateSemanticUnderstandingTaskRequest =
  | (CreateSemanticUnderstandingTaskBase & {
      scope: "catalog";
      catalogId: string;
    })
  | (CreateSemanticUnderstandingTaskBase & {
      scope: "resource";
      resourceId: string;
      includeSampleRows?: boolean;
      samplePolicy?: { masked?: false; maxRows?: number };
    });

export interface ListSemanticUnderstandingTasksOptions {
  scope?: SemanticUnderstandingScope;
  catalogId?: string;
  resourceId?: string;
  status?: z.infer<typeof VegaTaskStatus> | Array<z.infer<typeof VegaTaskStatus>>;
  applyMode?: SemanticUnderstandingApplyMode;
  applied?: boolean;
  offset?: number;
  limit?: number;
  sort?: SemanticUnderstandingTaskSort;
  direction?: "asc" | "desc";
}

export async function createSemanticUnderstandingTask(
  ctx: RequestContext,
  req: CreateSemanticUnderstandingTaskRequest,
): Promise<SemanticUnderstandingTask> {
  const target =
    req.scope === "catalog"
      ? { catalog_id: req.catalogId }
      : {
          resource_id: req.resourceId,
          ...(req.includeSampleRows !== undefined
            ? { include_sample_rows: req.includeSampleRows }
            : {}),
          ...(req.samplePolicy
            ? {
                sample_policy: {
                  ...(req.samplePolicy.masked !== undefined
                    ? { masked: req.samplePolicy.masked }
                    : {}),
                  ...(req.samplePolicy.maxRows !== undefined
                    ? { max_rows: req.samplePolicy.maxRows }
                    : {}),
                },
              }
            : {}),
        };
  const result = await request<unknown>(ctx, BASE, {
    method: "POST",
    body: {
      scope: req.scope,
      ...target,
      ...(req.applyMode !== undefined ? { apply_mode: req.applyMode } : {}),
      ...(req.confidenceThreshold !== undefined
        ? { confidence_threshold: req.confidenceThreshold }
        : {}),
    },
  });
  return SemanticUnderstandingTask.parse(result);
}

export async function listSemanticUnderstandingTasks(
  ctx: RequestContext,
  opts: ListSemanticUnderstandingTasksOptions = {},
): Promise<ListSemanticUnderstandingTasksResponse> {
  const result = await request<unknown>(ctx, BASE, {
    query: {
      scope: opts.scope,
      catalog_id: opts.catalogId || undefined,
      resource_id: opts.resourceId || undefined,
      status: opts.status,
      apply_mode: opts.applyMode,
      applied: opts.applied === undefined ? undefined : String(opts.applied),
      offset: opts.offset,
      limit: opts.limit ?? DEFAULT_LIST_LIMIT,
      sort: opts.sort,
      direction: opts.direction,
    },
  });
  return ListSemanticUnderstandingTasksResponse.parse(result);
}

export async function getSemanticUnderstandingTask(
  ctx: RequestContext,
  id: string,
): Promise<SemanticUnderstandingTask> {
  const result = await request<unknown>(ctx, `${BASE}/${encodeURIComponent(id)}`);
  return SemanticUnderstandingTask.parse(result);
}

export interface DeleteSemanticUnderstandingTasksOptions {
  ignoreMissing?: boolean;
}

export function deleteSemanticUnderstandingTasks(
  ctx: RequestContext,
  ids: string | string[],
  opts: DeleteSemanticUnderstandingTasksOptions = {},
): Promise<unknown> {
  const values = Array.isArray(ids) ? ids : [ids];
  return request(ctx, `${BASE}/${values.map(encodeURIComponent).join(",")}`, {
    method: "DELETE",
    query: {
      ignore_missing: opts.ignoreMissing === undefined ? undefined : String(opts.ignoreMissing),
    },
  });
}
