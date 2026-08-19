// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Vega discovery schedules and task lifecycle APIs. */
import { z } from "zod";
import { DEFAULT_LIST_LIMIT, type RequestContext } from "../types.js";
import { request } from "./http.js";

const VEGA_BASE = "/api/vega-backend/v1";

export const VegaAccountInfo = z
  .object({ id: z.string(), type: z.string(), name: z.string().optional() })
  .passthrough();
export type VegaAccountInfo = z.infer<typeof VegaAccountInfo>;

export const DiscoverStrategy = z.enum(["full_sync", "create_only", "cleanup_only"]);
export type DiscoverStrategy = z.infer<typeof DiscoverStrategy>;

export const VegaTaskStatus = z.enum(["pending", "running", "completed", "failed", "cancelled"]);
export type VegaTaskStatus = z.infer<typeof VegaTaskStatus>;

export const DiscoverScheduleSort = z.enum(["name", "create_time", "update_time", "next_run"]);
export type DiscoverScheduleSort = z.infer<typeof DiscoverScheduleSort>;

export const DiscoverTaskTriggerType = z.enum(["manual", "scheduled"]);
export type DiscoverTaskTriggerType = z.infer<typeof DiscoverTaskTriggerType>;

export const DiscoverTaskSort = z.enum([
  "create_time",
  "start_time",
  "finish_time",
  "last_progress_time",
]);
export type DiscoverTaskSort = z.infer<typeof DiscoverTaskSort>;

export const DiscoverSchedule = z
  .object({
    id: z.string(),
    name: z.string(),
    catalog_id: z.string(),
    catalog_name: z.string().optional(),
    cron_expr: z.string(),
    start_time: z.number().optional(),
    end_time: z.number().optional(),
    enabled: z.boolean(),
    strategy: DiscoverStrategy,
    last_run: z.number().optional(),
    next_run: z.number().optional(),
    creator: VegaAccountInfo,
    create_time: z.number(),
    updater: VegaAccountInfo,
    update_time: z.number(),
  })
  .passthrough();
export type DiscoverSchedule = z.infer<typeof DiscoverSchedule>;

export const ListDiscoverSchedulesResponse = z
  .object({ entries: z.array(DiscoverSchedule), total_count: z.number() })
  .passthrough();
export type ListDiscoverSchedulesResponse = z.infer<typeof ListDiscoverSchedulesResponse>;

export interface ListDiscoverSchedulesOptions {
  name?: string;
  catalogId?: string;
  enabled?: boolean;
  offset?: number;
  limit?: number;
  sort?: DiscoverScheduleSort;
  direction?: "asc" | "desc";
}

export interface CreateDiscoverScheduleRequest {
  name: string;
  catalogId: string;
  cronExpr: string;
  startTime?: number;
  endTime?: number;
  enabled?: boolean;
  strategy?: DiscoverStrategy;
}

export interface UpdateDiscoverScheduleRequest {
  name: string;
  catalogId: string;
  cronExpr: string;
  enabled: boolean;
  startTime?: number;
  endTime?: number;
  strategy?: DiscoverStrategy;
  /** Required optimistic-lock version from the latest schedule `update_time`. */
  expectedUpdateTime: number;
}

const IdResponse = z.object({ id: z.string() }).passthrough();

export async function listDiscoverSchedules(
  ctx: RequestContext,
  opts: ListDiscoverSchedulesOptions = {},
): Promise<ListDiscoverSchedulesResponse> {
  const result = await request<unknown>(ctx, `${VEGA_BASE}/discover-schedules`, {
    query: {
      name: opts.name || undefined,
      catalog_id: opts.catalogId || undefined,
      enabled: opts.enabled === undefined ? undefined : String(opts.enabled),
      offset: opts.offset,
      limit: opts.limit ?? DEFAULT_LIST_LIMIT,
      sort: opts.sort,
      direction: opts.direction,
    },
  });
  return ListDiscoverSchedulesResponse.parse(result);
}

export async function getDiscoverSchedule(
  ctx: RequestContext,
  id: string,
): Promise<DiscoverSchedule> {
  const result = await request<unknown>(
    ctx,
    `${VEGA_BASE}/discover-schedules/${encodeURIComponent(id)}`,
  );
  return DiscoverSchedule.parse(result);
}

export async function createDiscoverSchedule(
  ctx: RequestContext,
  req: CreateDiscoverScheduleRequest,
): Promise<{ id: string }> {
  const result = await request<unknown>(ctx, `${VEGA_BASE}/discover-schedules`, {
    method: "POST",
    body: mapDiscoverScheduleRequest(req),
  });
  return IdResponse.parse(result);
}

export function updateDiscoverSchedule(
  ctx: RequestContext,
  id: string,
  req: UpdateDiscoverScheduleRequest,
): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/discover-schedules/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: {
      ...mapDiscoverScheduleRequest(req),
      enabled: req.enabled,
      expected_update_time: req.expectedUpdateTime,
    },
  });
}

function mapDiscoverScheduleRequest(req: CreateDiscoverScheduleRequest) {
  return {
    name: req.name,
    catalog_id: req.catalogId,
    cron_expr: req.cronExpr,
    ...(req.startTime !== undefined ? { start_time: req.startTime } : {}),
    ...(req.endTime !== undefined ? { end_time: req.endTime } : {}),
    ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
    ...(req.strategy !== undefined ? { strategy: req.strategy } : {}),
  };
}

export function deleteDiscoverSchedule(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/discover-schedules/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function enableDiscoverSchedule(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/discover-schedules/${encodeURIComponent(id)}/enable`, {
    method: "POST",
  });
}

export function disableDiscoverSchedule(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/discover-schedules/${encodeURIComponent(id)}/disable`, {
    method: "POST",
  });
}

export const DiscoverResult = z
  .object({
    catalog_id: z.string(),
    new_count: z.number(),
    stale_count: z.number(),
    unchanged_count: z.number(),
    updated_count: z.number().optional(),
    restored_count: z.number().optional(),
    failed_count: z.number().optional(),
    message: z.string(),
  })
  .passthrough();
export type DiscoverResult = z.infer<typeof DiscoverResult>;

export const DiscoverTask = z
  .object({
    id: z.string(),
    catalog_id: z.string(),
    catalog_name: z.string().optional(),
    schedule_id: z.string(),
    strategy: DiscoverStrategy,
    trigger_type: z.enum(["manual", "scheduled"]),
    status: VegaTaskStatus,
    progress: z.number(),
    message: z.string(),
    start_time: z.number().optional(),
    finish_time: z.number().optional(),
    last_progress_time: z.number().optional(),
    result: DiscoverResult.optional(),
    creator: VegaAccountInfo,
    create_time: z.number(),
  })
  .passthrough();
export type DiscoverTask = z.infer<typeof DiscoverTask>;

const DiscoverTaskResultSummary = DiscoverResult.omit({ message: true }).extend({
  updated_count: z.number(),
  restored_count: z.number(),
  failed_count: z.number(),
});

export const DiscoverTaskSummary = DiscoverTask.omit({ message: true, result: true }).extend({
  result: DiscoverTaskResultSummary.optional(),
});
export type DiscoverTaskSummary = z.infer<typeof DiscoverTaskSummary>;

export const ListDiscoverTasksResponse = z
  .object({ entries: z.array(DiscoverTaskSummary), total_count: z.number() })
  .passthrough();
export type ListDiscoverTasksResponse = z.infer<typeof ListDiscoverTasksResponse>;

export interface ListDiscoverTasksOptions {
  catalogId?: string;
  scheduleId?: string;
  status?: VegaTaskStatus | VegaTaskStatus[];
  strategy?: DiscoverStrategy;
  triggerType?: DiscoverTaskTriggerType;
  offset?: number;
  limit?: number;
  sort?: DiscoverTaskSort;
  direction?: "asc" | "desc";
}

export async function listDiscoverTasks(
  ctx: RequestContext,
  opts: ListDiscoverTasksOptions = {},
): Promise<ListDiscoverTasksResponse> {
  const result = await request<unknown>(ctx, `${VEGA_BASE}/discover-tasks`, {
    query: {
      catalog_id: opts.catalogId || undefined,
      schedule_id: opts.scheduleId || undefined,
      status: opts.status,
      strategy: opts.strategy,
      trigger_type: opts.triggerType,
      offset: opts.offset,
      limit: opts.limit ?? DEFAULT_LIST_LIMIT,
      sort: opts.sort,
      direction: opts.direction,
    },
  });
  return ListDiscoverTasksResponse.parse(result);
}

export async function getDiscoverTask(ctx: RequestContext, id: string): Promise<DiscoverTask> {
  const result = await request<unknown>(
    ctx,
    `${VEGA_BASE}/discover-tasks/${encodeURIComponent(id)}`,
  );
  return DiscoverTask.parse(result);
}

export interface DeleteDiscoverTasksOptions {
  ignoreMissing?: boolean;
}

export function deleteDiscoverTasks(
  ctx: RequestContext,
  ids: string | string[],
  opts: DeleteDiscoverTasksOptions = {},
): Promise<unknown> {
  const values = Array.isArray(ids) ? ids : [ids];
  return request(ctx, `${VEGA_BASE}/discover-tasks/${values.map(encodeURIComponent).join(",")}`, {
    method: "DELETE",
    query: {
      ignore_missing: opts.ignoreMissing === undefined ? undefined : String(opts.ignoreMissing),
    },
  });
}

export async function discoverCatalog(
  ctx: RequestContext,
  catalogId: string,
  req: { strategy?: DiscoverStrategy } = {},
): Promise<{ id: string }> {
  const result = await request<unknown>(
    ctx,
    `${VEGA_BASE}/catalogs/${encodeURIComponent(catalogId)}/discover`,
    { method: "POST", body: req.strategy ? { strategy: req.strategy } : {} },
  );
  return IdResponse.parse(result);
}
