import type { RequestContext } from "../types.js";
/**
 * bkn-backend client (concept-groups, action-schedules, jobs). Read side,
 * mirroring kweaver-sdk api/bkn-backend.ts. Passed through as parsed JSON.
 */
import { HttpError } from "../utils/errors.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { applyTls } from "./tls.js";

const BASE = "/api/bkn-backend/v1/knowledge-networks";
const BKNS = "/api/bkn-backend/v1/bkns";

function knPath(knId: string, path: string): string {
  return `${BASE}/${encodeURIComponent(knId)}/${path}`;
}

/**
 * Upload a BKN tar to import it as a knowledge network.
 * `POST /api/bkn-backend/v1/bkns?branch=<branch>`, multipart `file`.
 * Returns the raw response (created kn id / status), passed through.
 */
export async function uploadBkn(
  ctx: RequestContext,
  tarBuffer: Buffer,
  opts: { branch?: string } = {},
): Promise<unknown> {
  applyTls(ctx);
  const url = new URL(`${ctx.baseUrl}${BKNS}`);
  url.searchParams.set("branch", opts.branch ?? "main");
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(tarBuffer)], { type: "application/octet-stream" }),
    "bkn.tar",
  );
  // Let fetch set the multipart boundary; only send auth/domain headers.
  const res = await fetch(url, { method: "POST", headers: buildHeaders(ctx), body: form });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, res.statusText, text);
  return text ? JSON.parse(text) : undefined;
}

/**
 * Download a knowledge network as a BKN tar.
 * `GET /api/bkn-backend/v1/bkns/<knId>?branch=<branch>` → raw tar bytes.
 */
export async function downloadBkn(
  ctx: RequestContext,
  knId: string,
  opts: { branch?: string } = {},
): Promise<Buffer> {
  applyTls(ctx);
  const url = new URL(`${ctx.baseUrl}${BKNS}/${encodeURIComponent(knId)}`);
  url.searchParams.set("branch", opts.branch ?? "main");
  const res = await fetch(url, { method: "GET", headers: buildHeaders(ctx) });
  if (!res.ok) throw new HttpError(res.status, res.statusText, await res.text());
  return Buffer.from(await res.arrayBuffer());
}

/** Query relation-type paths between object types (POST, caller-supplied body). */
export function relationTypePaths(
  ctx: RequestContext,
  knId: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, knPath(knId, "relation-type-paths"), { method: "POST", body });
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
