// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { DEFAULT_LIST_LIMIT, type RequestContext } from "../types.js";
/**
 * bkn-backend client (concept-groups, action-schedules). Read side.
 * Passed through as parsed JSON.
 */
import { HttpError, InputError } from "../utils/errors.js";
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
 * Turn caller ids (a comma-joined string or a list) into one path segment: each id
 * encoded on its own, the separating commas kept literal.
 */
export function idSegment(ids: string | string[]): string {
  const list = (Array.isArray(ids) ? ids : ids.split(",")).map((id) => id.trim()).filter(Boolean);
  // An empty segment would leave a trailing slash on a DELETE route: refuse it here.
  if (list.length === 0) throw new InputError("Name at least one id.");
  return list.map(encodeURIComponent).join(",");
}

/** How a create treats a concept whose id or name already exists. */
export type ImportMode = "normal" | "overwrite" | "ignore";

/** `branch` alone: the query flag every bkn-backend route under a network takes. */
export interface BranchOptions {
  branch?: string;
}

/** `branch` + `strict_mode`: updates and member edits. */
export interface StrictWriteOptions extends BranchOptions {
  /** Validate that dependencies exist (backend default true); false skips the check. */
  strictMode?: boolean;
}

/** `branch` + `strict_mode` + `import_mode`: creates and their validations. */
export interface ImportWriteOptions extends StrictWriteOptions {
  /** Duplicate concepts: `normal` errors (backend default), `overwrite` replaces, `ignore` skips. */
  importMode?: ImportMode;
}

/** The query string of a bkn-backend write; flags left unset are not sent. */
export function writeQuery(opts: ImportWriteOptions = {}) {
  return {
    branch: opts.branch || undefined,
    strict_mode: opts.strictMode === undefined ? undefined : String(opts.strictMode),
    import_mode: opts.importMode || undefined,
  };
}

/** Query flags `bkn push` (`POST /bkns`) accepts besides the branch. */
export interface BknImportOptions extends ImportWriteOptions {
  /** `preserve` keeps environment-local bindings; `detach` drops them. */
  bindingPolicy?: "preserve" | "detach";
}

/**
 * Upload a BKN tar to import it as a knowledge network.
 * `POST /api/bkn-backend/v1/bkns?branch=<branch>`, multipart `file`.
 * Returns the raw response (created kn id / status), passed through.
 */
export async function uploadBkn(
  ctx: RequestContext,
  tarBuffer: Buffer,
  opts: BknImportOptions = {},
): Promise<unknown> {
  const url = new URL(`${ctx.baseUrl}${BKNS}`);
  url.searchParams.set("branch", opts.branch ?? "main");
  if (opts.importMode) url.searchParams.set("import_mode", opts.importMode);
  if (opts.strictMode !== undefined) url.searchParams.set("strict_mode", String(opts.strictMode));
  if (opts.bindingPolicy) url.searchParams.set("binding_policy", opts.bindingPolicy);
  await ensureCompatible(ctx, url);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(tarBuffer)], { type: "application/octet-stream" }),
    "bkn.tar",
  );
  // Let fetch set the multipart boundary; only send auth/domain headers.
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx, url, { method: "POST", headers: buildHeaders(ctx), body: form }),
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
    tlsFetch(ctx, url, { method: "GET", headers: buildHeaders(ctx) }),
  );
  if (!res.ok) throw new HttpError(res.status, res.statusText, await res.text());
  return Buffer.from(await res.arrayBuffer());
}

export interface BknResourceListOptions {
  /** Name keyword filter. */
  keyword?: string;
  offset?: number;
  limit?: number;
  /** Sort field (backend default `name`). */
  sort?: string;
  direction?: "asc" | "desc";
}

/**
 * List BKN-backend resources (global, not per-KN).
 * `resource_type` is required and `knowledge_network` is the only value the backend
 * recognizes; without it the backend answers 200 with an empty body.
 */
export function listBknResources(
  ctx: RequestContext,
  opts: BknResourceListOptions = {},
): Promise<unknown> {
  return request(ctx, "/api/bkn-backend/v1/resources", {
    query: {
      resource_type: "knowledge_network",
      keyword: opts.keyword || undefined,
      offset: opts.offset,
      limit: opts.limit ?? DEFAULT_LIST_LIMIT,
      sort: opts.sort || undefined,
      direction: opts.direction || undefined,
    },
  });
}

/** Body of a Cypher query sent straight to bkn-backend. */
export interface CypherQueryBody {
  query: string;
  /** Values for the `$name` parameters; values only, never identifiers. */
  parameters?: Record<string, unknown>;
}

/**
 * Compile and run one read-only Cypher query against a knowledge network.
 * `POST /api/bkn-backend/v1/knowledge-networks/{kn_id}/cypher-queries[?branch=]`.
 *
 * A genuine POST, unlike the reads tunnelled below: no method override. Answers
 * `{columns, entries}`; the generated SQL is never returned.
 */
export function runCypherQuery(
  ctx: RequestContext,
  knId: string,
  body: CypherQueryBody,
  branch?: string,
): Promise<unknown> {
  return request(ctx, knPath(knId, "cypher-queries"), {
    method: "POST",
    body,
    query: { branch: branch || undefined },
    // Entries are raw row values: a BIGINT column past 2^53 must not be rounded.
    responseParser: parseBigIntJSON,
  });
}

/**
 * Query relation-type paths between object types (POST, caller-supplied body).
 * A read tunnelled over POST: without the override header the backend answers
 * `InvalidParameter.OverrideMethod` before it looks at the body. The published
 * spec does not declare that header on this route; the SDK keeps sending it.
 *
 * Body `direction`: `forward | backward | bidirectional`. The spec's enum says
 * `reverse`, but the backend answers 400 InvalidParameter.Direction for it
 * (verified on 14.103.77.23); its description and example say `backward`.
 */
export function relationTypePaths(
  ctx: RequestContext,
  knId: string,
  body: unknown,
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, "relation-type-paths"), {
    method: "POST",
    headers: { "X-HTTP-Method-Override": "GET" },
    query: { branch: opts.branch || undefined },
    body,
  });
}

export interface ConceptGroupListOptions {
  branch?: string;
  namePattern?: string;
  /** Exact tag match. */
  tag?: string;
  /** `update_time` | `name`. */
  sort?: string;
  direction?: "asc" | "desc";
  offset?: number;
  /** -1 = all. Defaults to -1: the backend's own default of 10 truncates silently. */
  limit?: number;
}

export function listConceptGroups(
  ctx: RequestContext,
  knId: string,
  opts: ConceptGroupListOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, "concept-groups"), {
    query: {
      branch: opts.branch || undefined,
      name_pattern: opts.namePattern || undefined,
      tag: opts.tag || undefined,
      sort: opts.sort || undefined,
      direction: opts.direction || undefined,
      offset: opts.offset,
      limit: opts.limit ?? -1,
    },
  });
}

export interface ConceptGroupGetOptions {
  branch?: string;
  /** Calculate and return statistics. */
  includeStatistics?: boolean;
  /** Response view mode; the default view when empty. */
  mode?: string;
}

export function getConceptGroup(
  ctx: RequestContext,
  knId: string,
  cgId: string,
  opts: ConceptGroupGetOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, `concept-groups/${encodeURIComponent(cgId)}`), {
    query: {
      branch: opts.branch || undefined,
      include_statistics: opts.includeStatistics ? "true" : undefined,
      mode: opts.mode || undefined,
    },
  });
}
export function createConceptGroup(
  ctx: RequestContext,
  knId: string,
  body: unknown,
  opts: ImportWriteOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, "concept-groups"), {
    method: "POST",
    query: writeQuery(opts),
    body,
  });
}
export function updateConceptGroup(
  ctx: RequestContext,
  knId: string,
  cgId: string,
  body: unknown,
  opts: StrictWriteOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, `concept-groups/${encodeURIComponent(cgId)}`), {
    method: "PUT",
    query: writeQuery({ branch: opts.branch, strictMode: opts.strictMode }),
    body,
  });
}
export function deleteConceptGroup(
  ctx: RequestContext,
  knId: string,
  cgId: string,
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, `concept-groups/${encodeURIComponent(cgId)}`), {
    method: "DELETE",
    query: { branch: opts.branch || undefined },
  });
}
export function addConceptGroupMembers(
  ctx: RequestContext,
  knId: string,
  cgId: string,
  body: unknown,
  opts: StrictWriteOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, `concept-groups/${encodeURIComponent(cgId)}/object-types`), {
    method: "POST",
    query: writeQuery({ branch: opts.branch, strictMode: opts.strictMode }),
    body,
  });
}
export function removeConceptGroupMembers(
  ctx: RequestContext,
  knId: string,
  cgId: string,
  otIds: string | string[],
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(
    ctx,
    knPath(knId, `concept-groups/${encodeURIComponent(cgId)}/object-types/${idSegment(otIds)}`),
    {
      method: "DELETE",
      query: { branch: opts.branch || undefined },
    },
  );
}

/**
 * One capability to bind. The binding is always tool-level: a skill by id, a tool box tool
 * by `(box_id, capability_id)`, an MCP Server tool by `(box_id = mcp_id, capability_id =
 * tool name)`. `all_tools` names a box or server and is expanded by the backend at write
 * time into one binding per tool it holds right now.
 */
export interface CapabilityAttachEntry {
  capability_type: "skill" | "function" | "mcp_tool";
  box_id?: string;
  capability_id?: string;
  all_tools?: boolean;
  comment?: string;
}

export interface CapabilityListOptions {
  branch?: string;
  /** `skill`, `function` or `mcp_tool`. */
  type?: string;
  /** Narrow function / mcp_tool bindings to one tool box or MCP Server. */
  boxId?: string;
  /** `openapi` or `function`: the kind of tool box behind a function binding. */
  metadataType?: string;
  /** Also backfill description and status — one extra call per skill. */
  withDetail?: boolean;
  limit?: number;
  offset?: number;
  /** `create_time` | `update_time`. */
  sort?: string;
  direction?: "asc" | "desc";
}

/**
 * List what a knowledge network branch has bound, with names backfilled from the
 * execution factory. `GET …/knowledge-networks/{kn_id}/capabilities`.
 */
export function listCapabilities(
  ctx: RequestContext,
  knId: string,
  opts: CapabilityListOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, "capabilities"), {
    query: {
      branch: opts.branch || undefined,
      type: opts.type || undefined,
      box_id: opts.boxId || undefined,
      metadata_type: opts.metadataType || undefined,
      with_detail: opts.withDetail ? "true" : undefined,
      limit: opts.limit,
      offset: opts.offset,
      sort: opts.sort || undefined,
      direction: opts.direction || undefined,
    },
  });
}

/**
 * Bind capabilities to a knowledge network branch; repeating a binding is a no-op.
 * `POST …/knowledge-networks/{kn_id}/capabilities` → `{entries, total_count}`.
 */
export function attachCapabilities(
  ctx: RequestContext,
  knId: string,
  capabilities: CapabilityAttachEntry[],
  branch?: string,
): Promise<unknown> {
  return request(ctx, knPath(knId, "capabilities"), {
    method: "POST",
    body: { capabilities },
    query: { branch: branch || undefined },
  });
}

/**
 * Release bindings by id. `DELETE …/knowledge-networks/{kn_id}/capabilities/{ids}`, the
 * ids comma-joined in one path segment.
 */
export function detachCapabilities(
  ctx: RequestContext,
  knId: string,
  bindingIds: string[],
  branch?: string,
): Promise<unknown> {
  return request(
    ctx,
    knPath(knId, `capabilities/${bindingIds.map(encodeURIComponent).join(",")}`),
    { method: "DELETE", query: { branch: branch || undefined } },
  );
}

export interface ActionScheduleListOptions {
  branch?: string;
  namePattern?: string;
  actionTypeId?: string;
  /** `active` | `inactive`. */
  status?: string;
  /** `create_time` | `update_time` | `next_run_time` | `last_run_time` | `name`. */
  sort?: string;
  direction?: "asc" | "desc";
  offset?: number;
  /** -1 = all. Defaults to -1: the backend's own default of 10 truncates silently. */
  limit?: number;
}

export function listActionSchedules(
  ctx: RequestContext,
  knId: string,
  opts: ActionScheduleListOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, "action-schedules"), {
    query: {
      branch: opts.branch || undefined,
      name_pattern: opts.namePattern || undefined,
      action_type_id: opts.actionTypeId || undefined,
      status: opts.status || undefined,
      sort: opts.sort || undefined,
      direction: opts.direction || undefined,
      offset: opts.offset,
      limit: opts.limit ?? -1,
    },
    // `_instance_identities` / `dynamic_params` hold primary-key values that can pass
    // 2^53; rounding them would corrupt the schedule on a read-edit-write round trip.
    responseParser: parseBigIntJSON,
  });
}
export function getActionSchedule(
  ctx: RequestContext,
  knId: string,
  scheduleId: string,
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, `action-schedules/${encodeURIComponent(scheduleId)}`), {
    query: { branch: opts.branch || undefined },
    responseParser: parseBigIntJSON,
  });
}

export function createActionSchedule(
  ctx: RequestContext,
  knId: string,
  body: unknown,
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, "action-schedules"), {
    method: "POST",
    query: { branch: opts.branch || undefined },
    body,
  });
}
export function updateActionSchedule(
  ctx: RequestContext,
  knId: string,
  scheduleId: string,
  body: unknown,
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, `action-schedules/${encodeURIComponent(scheduleId)}`), {
    method: "PUT",
    query: { branch: opts.branch || undefined },
    body,
  });
}
export function setActionScheduleStatus(
  ctx: RequestContext,
  knId: string,
  scheduleId: string,
  body: unknown,
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, `action-schedules/${encodeURIComponent(scheduleId)}/status`), {
    method: "PUT",
    query: { branch: opts.branch || undefined },
    body,
  });
}
export function deleteActionSchedules(
  ctx: RequestContext,
  knId: string,
  ids: string | string[],
  opts: BranchOptions = {},
): Promise<unknown> {
  return request(ctx, knPath(knId, `action-schedules/${idSegment(ids)}`), {
    method: "DELETE",
    query: { branch: opts.branch || undefined },
  });
}
