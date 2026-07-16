// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

/**
 * bkn-safe admin API (`/api/safe/v1/admin/*`, token-gated; the gateway-exposed
 * replacement for the retired ISF UserManagement / Authorization / EACP). The
 * logged-in user must be an admin: 401 = no/invalid token, 403 = not an admin.
 * Only `audit list` has no endpoint (login-log retired by design). Response
 * shapes: `{users|roles|departments, total}`; department `parent_id` (not the
 * ISF `parent_deps[]`). See docs/exec-plans/admin-bkn-safe-migration.md.
 * Also carries the cluster license hub (`/admin/license/*`, issue #224).
 */
import type { RequestContext } from "../types.js";
import { HttpError, InputError } from "../utils/errors.js";
import { request } from "./http.js";

const ADMIN = "/api/safe/v1/admin";

/** Thrown for admin ops with no bkn-safe endpoint (only `audit list`). */
export function notOnSafe(operation: string): never {
  throw new InputError(
    `'${operation}' is not available on bkn-safe — its admin API has no such endpoint. See docs/exec-plans/admin-bkn-safe-migration.md.`,
  );
}

// ── users ──────────────────────────────────────────────────────────────────

/** GET /admin/users?search=&offset=&limit= — list/search (account/name substring). */
export function listUsersSafe(
  ctx: RequestContext,
  opts: { search?: string; offset?: number; limit?: number } = {},
): Promise<unknown> {
  return request(ctx, `${ADMIN}/users`, {
    query: { search: opts.search || undefined, offset: opts.offset, limit: opts.limit },
  });
}

/** GET /admin/users?account= — exact login lookup ({users:[u]|[]}). */
export function findUserByAccountSafe(ctx: RequestContext, account: string): Promise<unknown> {
  return request(ctx, `${ADMIN}/users`, { query: { account } });
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
  accountType?: string;
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
      ...(input.accountType ? { account_type: input.accountType } : {}),
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
  id?: string;
}

/** POST /admin/departments → 201 {id}. */
export function createDepartmentSafe(
  ctx: RequestContext,
  input: CreateDeptSafeInput,
): Promise<{ id: string }> {
  return request(ctx, `${ADMIN}/departments`, {
    method: "POST",
    body: {
      name: input.name,
      ...(input.parentId ? { parent_id: input.parentId } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.id ? { id: input.id } : {}),
    },
  }) as Promise<{ id: string }>;
}

/** PUT /admin/departments/:id — partial update. */
export function updateDepartmentSafe(
  ctx: RequestContext,
  deptId: string,
  input: { name?: string; parentId?: string; type?: string },
): Promise<unknown> {
  return request(ctx, `${ADMIN}/departments/${encodeURIComponent(deptId)}`, {
    method: "PUT",
    body: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
    },
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

/** Build a nested department tree from the flat `GET /admin/departments` list. */
export async function buildDepartmentTree(ctx: RequestContext): Promise<unknown[]> {
  const res = (await listDepartmentsSafe(ctx, { limit: 1000 })) as
    | { departments?: DeptNode[] }
    | DeptNode[];
  const flat = Array.isArray(res) ? res : (res.departments ?? []);
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
