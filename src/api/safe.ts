// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * bkn-safe admin API (`/api/safe/v1/admin/*`, token-gated; the gateway-exposed
 * replacement for the retired ISF UserManagement / Authorization / EACP). The
 * logged-in user must be an admin: 401 = no/invalid token, 403 = not an admin.
 * The audit trail is `/admin/audit-logs` (management mutations + refusals, not
 * the retired EACP login-log; needs `admin-audit:view`). Response
 * shapes: `{users|roles|departments, total}`; department `parent_id` (not the
 * ISF `parent_deps[]`). See docs/exec-plans/admin-bkn-safe-migration.md.
 * Also carries the cluster license hub (`/admin/license/*`, issue #224).
 */
import type { RequestContext } from "../types.js";
import { HttpError, InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { request } from "./http.js";

const ADMIN = "/api/safe/v1/admin";

/** Thrown for admin ops with no bkn-safe endpoint. */
export function notOnSafe(operation: string): never {
  throw new InputError(
    `'${operation}' is not available on bkn-safe — its admin API has no such endpoint. See docs/exec-plans/admin-bkn-safe-migration.md.`,
  );
}

// ── users ──────────────────────────────────────────────────────────────────

/** Server cap on one `GET /admin/users` page. */
export const USER_PAGE_MAX = 500;
/** Server cap on one flat `GET /admin/departments` page. */
export const DEPARTMENT_PAGE_MAX = 1000;
/** Upper bound on pages followed when reading a whole directory list. */
const DIRECTORY_PAGE_CAP = 200;

/**
 * GET /admin/users?search=&department_id=&offset=&limit= — list/search
 * (account/name substring; `department_id` = direct members of that department).
 */
export function listUsersSafe(
  ctx: RequestContext,
  opts: { search?: string; departmentId?: string; offset?: number; limit?: number } = {},
): Promise<unknown> {
  return request(ctx, `${ADMIN}/users`, {
    query: {
      search: opts.search || undefined,
      department_id: opts.departmentId || undefined,
      offset: opts.offset,
      limit: opts.limit,
    },
  });
}

/**
 * Read a paged directory list until `done` says stop, the server returns a short
 * or empty page, `total` is reached, or the page cap is hit.
 */
export async function pageDirectory<T>(
  fetchPage: (offset: number, limit: number) => Promise<unknown>,
  key: "users" | "departments",
  pageSize: number,
  done: (rows: T[]) => boolean = () => false,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < DIRECTORY_PAGE_CAP; page += 1) {
    const res = (await fetchPage(rows.length, pageSize)) as
      | ({ total?: number | bigint } & Record<string, unknown>)
      | T[]
      | undefined;
    const batch = (Array.isArray(res) ? res : ((res?.[key] as T[] | undefined) ?? [])) as T[];
    rows.push(...batch);
    const total = Array.isArray(res) ? undefined : res?.total;
    // `done` sees every page, including the last one.
    const satisfied = done(rows);
    if (satisfied || batch.length === 0 || batch.length < pageSize) break;
    if (total !== undefined && rows.length >= Number(total)) break;
  }
  return rows;
}

/**
 * GET /api/safe/v1/me — the caller's own directory record ({id, account, name,
 * email, roles, ...}). Any logged-in user may read it, so identity display
 * uses this instead of the admin-only `/admin/users/:id`, which answers a
 * non-admin with a 403 that bkn-safe writes to the audit trail as a refusal.
 */
export function getMeSafe(ctx: RequestContext): Promise<unknown> {
  return request(ctx, "/api/safe/v1/me");
}

/** GET /admin/users/:id — detail (incl. roles + departments). */
export function getUserSafe(ctx: RequestContext, userId: string): Promise<unknown> {
  return request(ctx, `${ADMIN}/users/${encodeURIComponent(userId)}`);
}

export interface CreateUserSafeInput {
  account: string;
  password: string;
  name?: string;
  email?: string;
  telephone?: string;
  accountType?: string;
  /** Initial department membership; unknown ids fail the create with 400. */
  departmentIds?: string[];
  id?: string;
}

/** POST /admin/users — create a local user (plaintext password over TLS). */
export function createUserSafe(
  ctx: RequestContext,
  input: CreateUserSafeInput,
): Promise<{ id: string }> {
  return request(ctx, `${ADMIN}/users`, {
    method: "POST",
    body: {
      account: input.account,
      password: input.password,
      ...(input.name ? { name: input.name } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.telephone ? { telephone: input.telephone } : {}),
      ...(input.accountType ? { account_type: input.accountType } : {}),
      ...(input.departmentIds?.length ? { department_ids: input.departmentIds } : {}),
      ...(input.id ? { id: input.id } : {}),
    },
  }) as Promise<{ id: string }>;
}

export interface UpdateUserSafeInput {
  name?: string;
  email?: string;
  telephone?: string;
  enabled?: boolean;
  accountType?: string;
  /** Replaces the user's department membership. */
  departmentIds?: string[];
}

/** PUT /admin/users/:id — partial update (only provided fields). */
export function updateUserSafe(
  ctx: RequestContext,
  userId: string,
  input: UpdateUserSafeInput,
): Promise<unknown> {
  return request(ctx, `${ADMIN}/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.telephone !== undefined ? { telephone: input.telephone } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.accountType !== undefined ? { account_type: input.accountType } : {}),
      ...(input.departmentIds !== undefined ? { department_ids: input.departmentIds } : {}),
    },
  });
}

/** DELETE /admin/users/:id (204). */
export async function deleteUserSafe(ctx: RequestContext, userId: string): Promise<{ ok: true }> {
  await request(ctx, `${ADMIN}/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
  return { ok: true };
}

/** PUT /admin/users/:id/password — admin reset (plaintext, sets must-change). */
export async function setUserPasswordSafe(
  ctx: RequestContext,
  userId: string,
  password: string,
): Promise<{ ok: true }> {
  await request(ctx, `${ADMIN}/users/${encodeURIComponent(userId)}/password`, {
    method: "PUT",
    body: { password },
  });
  return { ok: true };
}

/**
 * POST /api/safe/v1/auth/change-password — self-service change. Outside
 * `/admin` and unauthenticated by design (it's a pre-login credential change),
 * so it spells out its own path. Plaintext over TLS. 204 on success; 401 wrong
 * account/old password; 400 new == old.
 */
export async function changePasswordSafe(
  ctx: RequestContext,
  account: string,
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: true }> {
  await request(ctx, "/api/safe/v1/auth/change-password", {
    method: "POST",
    body: { account, old_password: oldPassword, new_password: newPassword },
  });
  return { ok: true };
}

// ── role bindings ────────────────────────────────────────────────────────────

/** GET /admin/role-bindings?accessor_id= — role ids bound to a user ({role_ids}). */
export function getUserRolesSafe(ctx: RequestContext, userId: string): Promise<unknown> {
  return request(ctx, `${ADMIN}/role-bindings`, { query: { accessor_id: userId } });
}

/** POST /admin/role-bindings — bind accessor → role (204). */
export async function assignRoleSafe(
  ctx: RequestContext,
  accessorId: string,
  roleId: string,
): Promise<{ ok: true }> {
  await request(ctx, `${ADMIN}/role-bindings`, {
    method: "POST",
    body: { accessor_id: accessorId, role_id: roleId },
  });
  return { ok: true };
}

/** DELETE /admin/role-bindings — unbind accessor from role (204, idempotent). */
export async function removeRoleSafe(
  ctx: RequestContext,
  accessorId: string,
  roleId: string,
): Promise<{ ok: true }> {
  await request(ctx, `${ADMIN}/role-bindings`, {
    method: "DELETE",
    body: { accessor_id: accessorId, role_id: roleId },
  });
  return { ok: true };
}

// ── departments ──────────────────────────────────────────────────────────────

/** GET /admin/departments?search=&parent_id=&offset=&limit= — list/search. */
export function listDepartmentsSafe(
  ctx: RequestContext,
  opts: { search?: string; parentId?: string; offset?: number; limit?: number } = {},
): Promise<unknown> {
  return request(ctx, `${ADMIN}/departments`, {
    query: {
      search: opts.search || undefined,
      parent_id: opts.parentId,
      offset: opts.offset,
      limit: opts.limit,
    },
  });
}

/** GET /admin/departments/:id. */
export function getDepartmentSafe(ctx: RequestContext, deptId: string): Promise<unknown> {
  return request(ctx, `${ADMIN}/departments/${encodeURIComponent(deptId)}`);
}

/** GET /admin/departments/:id/members — direct members ({users, total}). */
export function getDepartmentMembersSafe(ctx: RequestContext, deptId: string): Promise<unknown> {
  return request(ctx, `${ADMIN}/departments/${encodeURIComponent(deptId)}/members`);
}

export interface CreateDeptSafeInput {
  name: string;
  parentId?: string;
  type?: string;
  managerId?: string;
  code?: string;
  email?: string;
  remark?: string;
  id?: string;
}

/** PUT /admin/departments/:id body — present fields change (empty string clears). */
export type UpdateDeptSafeInput = Partial<Omit<CreateDeptSafeInput, "id">>;

function departmentBody(input: UpdateDeptSafeInput, keepEmpty: boolean): Record<string, string> {
  const body: Record<string, string> = {};
  const fields: Array<[keyof UpdateDeptSafeInput, string]> = [
    ["name", "name"],
    ["parentId", "parent_id"],
    ["type", "type"],
    ["managerId", "manager_id"],
    ["code", "code"],
    ["email", "email"],
    ["remark", "remark"],
  ];
  for (const [field, wire] of fields) {
    const value = input[field];
    if (value === undefined || (!keepEmpty && value === "")) continue;
    body[wire] = value;
  }
  return body;
}

/** POST /admin/departments → 201 {id}. */
export function createDepartmentSafe(
  ctx: RequestContext,
  input: CreateDeptSafeInput,
): Promise<{ id: string }> {
  return request(ctx, `${ADMIN}/departments`, {
    method: "POST",
    body: {
      ...departmentBody(input, false),
      name: input.name,
      ...(input.id ? { id: input.id } : {}),
    },
  }) as Promise<{ id: string }>;
}

/** PUT /admin/departments/:id — partial update. */
export function updateDepartmentSafe(
  ctx: RequestContext,
  deptId: string,
  input: UpdateDeptSafeInput,
): Promise<unknown> {
  return request(ctx, `${ADMIN}/departments/${encodeURIComponent(deptId)}`, {
    method: "PUT",
    body: departmentBody(input, true),
  });
}

/** DELETE /admin/departments/:id (204; 409 if non-empty). */
export async function deleteDepartmentSafe(
  ctx: RequestContext,
  deptId: string,
): Promise<{ ok: true }> {
  await request(ctx, `${ADMIN}/departments/${encodeURIComponent(deptId)}`, { method: "DELETE" });
  return { ok: true };
}

interface DeptNode {
  id?: string;
  parent_id?: string;
  children?: DeptNode[];
  [k: string]: unknown;
}

/** Build a nested department tree from the flat `GET /admin/departments` list (all pages). */
export async function buildDepartmentTree(ctx: RequestContext): Promise<unknown[]> {
  const flat = await pageDirectory<DeptNode>(
    (offset, limit) => listDepartmentsSafe(ctx, { offset, limit }),
    "departments",
    DEPARTMENT_PAGE_MAX,
  );
  const byId = new Map<string, DeptNode>();
  for (const d of flat) if (d.id) byId.set(d.id, { ...d, children: [] });
  const roots: DeptNode[] = [];
  for (const d of byId.values()) {
    const parent = d.parent_id ? byId.get(d.parent_id) : undefined;
    if (parent) parent.children?.push(d);
    else roots.push(d);
  }
  return roots;
}

// ── roles ──────────────────────────────────────────────────────────────────

/** GET /admin/roles?source= — all roles ({roles}); filter client-side. */
export function listRolesSafe(ctx: RequestContext, source?: string): Promise<unknown> {
  return request(ctx, `${ADMIN}/roles`, { query: { source: source || undefined } });
}

/** GET /admin/roles/:id — detail (members + permissions). */
export function getRoleSafe(ctx: RequestContext, roleId: string): Promise<unknown> {
  return request(ctx, `${ADMIN}/roles/${encodeURIComponent(roleId)}`);
}

/** GET /admin/roles/:id/members → {accessor_ids}. */
export function roleMembersSafe(ctx: RequestContext, roleId: string): Promise<unknown> {
  return request(ctx, `${ADMIN}/roles/${encodeURIComponent(roleId)}/members`);
}

/** POST /admin/roles — create a custom role → 201 {id}. */
export function createRoleSafe(
  ctx: RequestContext,
  input: { name: string; description?: string; id?: string },
): Promise<{ id: string }> {
  return request(ctx, `${ADMIN}/roles`, {
    method: "POST",
    body: {
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      ...(input.id ? { id: input.id } : {}),
    },
  }) as Promise<{ id: string }>;
}

/** PUT /admin/roles/:id — rename/describe (custom only; 403 built-in). */
export function updateRoleSafe(
  ctx: RequestContext,
  roleId: string,
  input: { name?: string; description?: string },
): Promise<unknown> {
  return request(ctx, `${ADMIN}/roles/${encodeURIComponent(roleId)}`, {
    method: "PUT",
    body: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
}

/** DELETE /admin/roles/:id — custom only; 403 built-in (purges bindings+grants). */
export async function deleteRoleSafe(ctx: RequestContext, roleId: string): Promise<{ ok: true }> {
  await request(ctx, `${ADMIN}/roles/${encodeURIComponent(roleId)}`, { method: "DELETE" });
  return { ok: true };
}

export interface RolePermissionInput {
  resourceType: string;
  resourceId: string; // "*" = whole type
  operations: string[];
}

/** POST|DELETE /admin/roles/:id/permissions — grant/revoke (custom only). */
export async function setRolePermissionSafe(
  ctx: RequestContext,
  roleId: string,
  grant: boolean,
  perm: RolePermissionInput,
): Promise<{ ok: true }> {
  await request(ctx, `${ADMIN}/roles/${encodeURIComponent(roleId)}/permissions`, {
    method: grant ? "POST" : "DELETE",
    body: {
      resource: { type: perm.resourceType, id: perm.resourceId },
      operations: perm.operations,
    },
  });
  return { ok: true };
}

// ── audit logs (bkn-safe/audit.yaml) ─────────────────────────────────────────

/** Server cap on one audit page (`limit`; default 50 when omitted). */
export const AUDIT_LOG_MAX_LIMIT = 500;

/** Filters for GET /admin/audit-logs. All filters combine with AND. */
export interface AuditLogQuery {
  /** Token subject id of the actor (not an account name). */
  actorId?: string;
  /** All rows written for one mutating HTTP request (a batch writes one per target). */
  requestId?: string;
  /** Top-level route noun, e.g. `users`, `role-bindings`, `policies`. */
  resource?: string;
  /** Business verb, e.g. `create`, `grant`, `revoke`, `reset_password`. */
  action?: string;
  targetId?: string;
  /** Only 4xx/5xx rows — refused and failed attempts. */
  failedOnly?: boolean;
  /** Inclusive lower bound on `created_at`, RFC 3339. */
  from?: string;
  /** Exclusive upper bound on `created_at`, RFC 3339. */
  to?: string;
  /** Keyset tiebreaker for rows sharing the `to` timestamp. */
  beforeId?: string;
  offset?: number;
  /** Page size, 0..500 (server default 50). */
  limit?: number;
}

/** One audit row. `seq` is int64 and arrives as bigint when unsafe. */
export interface AuditLogEntry {
  id: string;
  actor_id?: string;
  actor_name_snapshot?: string;
  actor_type?: "user" | "service" | "anonymous";
  auth_method?: "oauth" | "network" | "none";
  credential_id?: string;
  request_id?: string;
  source_channel?: "api" | "internal";
  method?: string;
  resource?: string;
  action?: string;
  target_id?: string;
  target_name?: string;
  detail?: string;
  status?: number;
  client_ip?: string;
  created_at?: string;
  seq?: number | bigint;
  prev_hash?: string;
  row_hash?: string;
}

export interface AuditLogPage {
  logs: AuditLogEntry[];
  /** Matching audit rows (not HTTP requests); int64. */
  total: number | bigint;
}

/** GET /admin/audit-logs — audit entries, newest first. */
export async function listAuditLogsSafe(
  ctx: RequestContext,
  query: AuditLogQuery = {},
): Promise<AuditLogPage> {
  if (
    query.limit !== undefined &&
    (!Number.isInteger(query.limit) || query.limit < 0 || query.limit > AUDIT_LOG_MAX_LIMIT)
  ) {
    throw new InputError(
      `Audit log limit must be an integer between 0 and ${AUDIT_LOG_MAX_LIMIT}; got ${query.limit}.`,
    );
  }
  if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) {
    throw new InputError(`Audit log offset must be a non-negative integer; got ${query.offset}.`);
  }
  return request<AuditLogPage>(ctx, `${ADMIN}/audit-logs`, {
    query: {
      actor_id: query.actorId || undefined,
      request_id: query.requestId || undefined,
      resource: query.resource || undefined,
      action: query.action || undefined,
      target_id: query.targetId || undefined,
      failed_only: query.failedOnly ? true : undefined,
      from: query.from || undefined,
      to: query.to || undefined,
      before_id: query.beforeId || undefined,
      offset: query.offset,
      limit: query.limit,
    },
    // `total` and `seq` are int64.
    responseParser: parseBigIntJSON,
  });
}

/** GET /admin/audit-logs/:id — one audit entry. */
export function getAuditLogSafe(ctx: RequestContext, id: string): Promise<AuditLogEntry> {
  return request<AuditLogEntry>(ctx, `${ADMIN}/audit-logs/${encodeURIComponent(id)}`, {
    responseParser: parseBigIntJSON,
  });
}

// ── license (cluster license hub) ────────────────────────────────────────────
// bkn-safe holds the cluster's one signed .lic; import/activate/remove happen
// here and nowhere else. Its state answers are WEAK judgements (display/ops) —
// modules gate by verifying the license signature locally, never off this API.

/** licverify judgement states. `invalid` also covers "no license installed". */
export type LicenseState = "valid" | "grace" | "fallback_community" | "invalid";

/** GET /admin/license response (admin detail view). */
export interface LicenseDetail {
  state: LicenseState;
  /** Whether the installed license is fingerprint-bound to this instance. */
  activated: boolean;
  /** This cluster's machine code (present even with no license installed). */
  instance_fp: string;
  error?: string;
  /** Background auto-renew failure — license itself may still be valid. */
  renew_error?: string;
  edition?: string;
  lic_id?: string;
  customer?: { name?: string; [k: string]: unknown };
  /** Unix seconds; expires_at 0 = never expires (community). */
  issued_at?: number;
  expires_at?: number;
  contract_expires_at?: number;
  /** Only present in `grace` state. */
  grace_remaining_days?: number;
  features?: string[];
  limits?: Record<string, number>;
}

/**
 * Import outcome. Plain success = the stored license's detail. `stored: true`
 * = the .lic was verified and stored, but issuer activation failed (HTTP
 * 409/502) — both facts matter, the import is not lost.
 */
export type LicenseImportResult =
  | LicenseDetail
  | { stored: true; error: string; license: LicenseDetail };

/** GET /admin/license — current license detail (weak judgement). */
export function getLicenseSafe(ctx: RequestContext): Promise<LicenseDetail> {
  return request(ctx, `${ADMIN}/license`);
}

/**
 * POST /admin/license/import (or /receipt) — verify and store a full .lic
 * text; online deployments auto-activate. `receipt` marks an offline
 * activation receipt (same verification; separate route for UI flow + audit).
 * Throws 400 = malformed/bad signature, 409 = bound to another instance;
 * a `stored:true` error body (activation refused after storing) is returned,
 * not thrown.
 */
export async function importLicenseSafe(
  ctx: RequestContext,
  licenseText: string,
  opts: { receipt?: boolean } = {},
): Promise<LicenseImportResult> {
  const text = licenseText.trim();
  if (!text) throw new InputError("license text is empty");
  try {
    return await request(ctx, `${ADMIN}/license/${opts.receipt ? "receipt" : "import"}`, {
      method: "POST",
      body: { license: text },
    });
  } catch (err) {
    if (err instanceof HttpError) {
      const stored = storedImport(err.body);
      if (stored) return stored;
    }
    throw err;
  }
}

/** Parse a stored-but-activation-failed import error body, if that's what it is. */
function storedImport(
  body: string,
): { stored: true; error: string; license: LicenseDetail } | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed && parsed.stored === true) return parsed;
  } catch {
    /* not JSON — a real error */
  }
  return null;
}

/**
 * POST /admin/license/activate — report the installed license to the issuer
 * and store the reissued, fingerprint-bound text. Throws 400 = offline
 * deployment or no license, 409 = already activated by another instance,
 * 502 = issuer unreachable.
 */
export function activateLicenseSafe(ctx: RequestContext): Promise<LicenseDetail> {
  return request(ctx, `${ADMIN}/license/activate`, { method: "POST" });
}

/** DELETE /admin/license — drop the installed license (204; back to unactivated). */
export async function removeLicenseSafe(ctx: RequestContext): Promise<{ ok: true }> {
  await request(ctx, `${ADMIN}/license`, { method: "DELETE" });
  return { ok: true };
}

/**
 * GET /admin/license/fingerprint — this cluster's machine code. Works with no
 * license installed: quoted for portal registration and offline activation
 * (activation request codes are retired — the raw fingerprint is what's pasted).
 */
export function getLicenseFingerprintSafe(ctx: RequestContext): Promise<{ instance_fp: string }> {
  return request(ctx, `${ADMIN}/license/fingerprint`);
}
