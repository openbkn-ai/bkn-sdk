// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import type { RequestContext } from "../types.js";
/**
 * bkn-backend client (concept-groups, action-schedules). Read side.
 * Passed through as parsed JSON.
 */
import { HttpError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { authFetch } from "./auth-fetch.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { tlsFetch } from "./tls.js";
import { ensureCompatible } from "./version-check.js";

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
  const url = new URL(`${ctx.baseUrl}${BKNS}`);
  url.searchParams.set("branch", opts.branch ?? "main");
  await ensureCompatible(ctx, url);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(tarBuffer)], { type: "application/octet-stream" }),
    "bkn.tar",
  );
  // Let fetch set the multipart boundary; only send auth/domain headers.
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx.insecure, url, { method: "POST", headers: buildHeaders(ctx), body: form }),
  );
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, res.statusText, text);
  return text ? parseBigIntJSON(text) : undefined;
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
  const url = new URL(`${ctx.baseUrl}${BKNS}/${encodeURIComponent(knId)}`);
  url.searchParams.set("branch", opts.branch ?? "main");
  await ensureCompatible(ctx, url);
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx.insecure, url, { method: "GET", headers: buildHeaders(ctx) }),
  );
  if (!res.ok) throw new HttpError(res.status, res.statusText, await res.text());
  return Buffer.from(await res.arrayBuffer());
}

/** List BKN-backend resources (global, not per-KN). */
export function listBknResources(ctx: RequestContext): Promise<unknown> {
  return request(ctx, "/api/bkn-backend/v1/resources");
}

/**
 * Query relation-type paths between object types (POST, caller-supplied body).
 * A read tunnelled over POST: without the override header the backend answers
 * `InvalidParameter.OverrideMethod` before it looks at the body.
 */
export function relationTypePaths(
  ctx: RequestContext,
  knId: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, knPath(knId, "relation-type-paths"), {
    method: "POST",
    headers: { "X-HTTP-Method-Override": "GET" },
    body,
  });
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
