/**
 * bkn-backend client (concept-groups, action-schedules, jobs). Read side,
 * mirroring kweaver-sdk api/bkn-backend.ts. Passed through as parsed JSON.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const BASE = "/api/bkn-backend/v1/knowledge-networks";

function knPath(knId: string, path: string): string {
  return `${BASE}/${encodeURIComponent(knId)}/${path}`;
}

export function listConceptGroups(ctx: RequestContext, knId: string): Promise<unknown> {
  return request(ctx, knPath(knId, "concept-groups"));
}
export function getConceptGroup(ctx: RequestContext, knId: string, cgId: string): Promise<unknown> {
  return request(ctx, knPath(knId, `concept-groups/${encodeURIComponent(cgId)}`));
}

export function listActionSchedules(ctx: RequestContext, knId: string): Promise<unknown> {
  return request(ctx, knPath(knId, "action-schedules"));
}
export function getActionSchedule(
  ctx: RequestContext,
  knId: string,
  scheduleId: string,
): Promise<unknown> {
  return request(ctx, knPath(knId, `action-schedules/${encodeURIComponent(scheduleId)}`));
}

export function listJobs(ctx: RequestContext, knId: string): Promise<unknown> {
  return request(ctx, knPath(knId, "jobs"));
}
export function getJob(ctx: RequestContext, knId: string, jobId: string): Promise<unknown> {
  return request(ctx, knPath(knId, `jobs/${encodeURIComponent(jobId)}`));
}
export function getJobTasks(ctx: RequestContext, knId: string, jobId: string): Promise<unknown> {
  return request(ctx, knPath(knId, `jobs/${encodeURIComponent(jobId)}/tasks`));
}
