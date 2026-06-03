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
export function createConceptGroup(
  ctx: RequestContext,
  knId: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, knPath(knId, "concept-groups"), { method: "POST", body });
}
export function updateConceptGroup(
  ctx: RequestContext,
  knId: string,
  cgId: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, knPath(knId, `concept-groups/${encodeURIComponent(cgId)}`), {
    method: "PUT",
    body,
  });
}
export function deleteConceptGroup(
  ctx: RequestContext,
  knId: string,
  cgId: string,
): Promise<unknown> {
  return request(ctx, knPath(knId, `concept-groups/${encodeURIComponent(cgId)}`), {
    method: "DELETE",
  });
}
export function addConceptGroupMembers(
  ctx: RequestContext,
  knId: string,
  cgId: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, knPath(knId, `concept-groups/${encodeURIComponent(cgId)}/object-types`), {
    method: "POST",
    body,
  });
}
export function removeConceptGroupMembers(
  ctx: RequestContext,
  knId: string,
  cgId: string,
  otIds: string,
): Promise<unknown> {
  return request(
    ctx,
    knPath(knId, `concept-groups/${encodeURIComponent(cgId)}/object-types/${otIds}`),
    {
      method: "DELETE",
    },
  );
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

export function createActionSchedule(
  ctx: RequestContext,
  knId: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, knPath(knId, "action-schedules"), { method: "POST", body });
}
export function updateActionSchedule(
  ctx: RequestContext,
  knId: string,
  scheduleId: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, knPath(knId, `action-schedules/${encodeURIComponent(scheduleId)}`), {
    method: "PUT",
    body,
  });
}
export function setActionScheduleStatus(
  ctx: RequestContext,
  knId: string,
  scheduleId: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, knPath(knId, `action-schedules/${encodeURIComponent(scheduleId)}/status`), {
    method: "PUT",
    body,
  });
}
export function deleteActionSchedules(
  ctx: RequestContext,
  knId: string,
  ids: string,
): Promise<unknown> {
  return request(ctx, knPath(knId, `action-schedules/${ids}`), { method: "DELETE" });
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
export function deleteJobs(ctx: RequestContext, knId: string, ids: string): Promise<unknown> {
  return request(ctx, knPath(knId, `jobs/${ids}`), { method: "DELETE" });
}
