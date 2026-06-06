/**
 * bkn-safe admin surface (`/api/safe/v1/directory` + `/authz`). The redesigned
 * replacement for the decommissioned ISF UserManagement / Authorization / EACP
 * services. Deliberately minimal (bkn-safe owns identities, not a full admin
 * UI): create user, set password, role-binding, plus id-keyed reads. Operations
 * the ISF API had but bkn-safe does not (enumerate users, dept/user update +
 * delete, role list, unbind, audit) have no endpoint — see
 * docs/exec-plans/admin-bkn-safe-migration.md.
 */
import type { RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import { request } from "./http.js";

const DIR = "/api/safe/v1/directory";
const AUTHZ = "/api/safe/v1/authz";

/** Thrown for admin ops with no bkn-safe endpoint, instead of a raw 503/404. */
export function notOnSafe(operation: string): never {
  throw new InputError(
    `'${operation}' is not available on bkn-safe — its admin API has no such endpoint. See docs/exec-plans/admin-bkn-safe-migration.md.`,
  );
}

/** GET /directory/users/:id — full user detail. */
export function getUserSafe(ctx: RequestContext, userId: string): Promise<unknown> {
  return request(ctx, `${DIR}/users/${encodeURIComponent(userId)}`);
}

/** POST /users-detail — batch user records; we use it to read one user's roles. */
export async function getUserRolesSafe(ctx: RequestContext, userId: string): Promise<unknown> {
  const res = (await request(ctx, `${DIR}/users-detail`, {
    method: "POST",
    body: { user_ids: [userId] },
  })) as { users?: Array<{ roles?: unknown }> };
  return res.users?.[0]?.roles ?? [];
}

export interface CreateUserSafeInput {
  account: string;
  password: string;
  name?: string;
  email?: string;
  accountType?: string;
  id?: string;
}

/** POST /directory/users — create a local user. Returns `{ id }`. */
export function createUserSafe(
  ctx: RequestContext,
  input: CreateUserSafeInput,
): Promise<{ id: string }> {
  return request(ctx, `${DIR}/users`, {
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

/** PUT /directory/users/:id/password — reset a local user's password (204). */
export async function setUserPasswordSafe(
  ctx: RequestContext,
  userId: string,
  password: string,
): Promise<{ ok: true }> {
  await request(ctx, `${DIR}/users/${encodeURIComponent(userId)}/password`, {
    method: "PUT",
    body: { password },
  });
  return { ok: true };
}

/** POST /authz/role-bindings — bind an accessor (user/group) to a role (204). */
export async function assignRoleSafe(
  ctx: RequestContext,
  accessorId: string,
  roleId: string,
): Promise<{ ok: true }> {
  await request(ctx, `${AUTHZ}/role-bindings`, {
    method: "POST",
    body: { accessor_id: accessorId, role_id: roleId },
  });
  return { ok: true };
}

/** GET /directory/departments?parent_id= — list departments under a parent ("" = roots). */
export function listDepartmentsSafe(ctx: RequestContext, parentId = ""): Promise<unknown> {
  return request(ctx, `${DIR}/departments`, { query: { parent_id: parentId || undefined } });
}

/** POST /directory/departments-detail — batch department info (ancestor chains). */
export async function getDepartmentSafe(ctx: RequestContext, deptId: string): Promise<unknown> {
  const res = (await request(ctx, `${DIR}/departments-detail`, {
    method: "POST",
    body: { department_ids: [deptId] },
  })) as { departments?: unknown[] };
  return res.departments?.[0] ?? null;
}

interface DeptNode {
  id?: string;
  name?: string;
  children?: DeptNode[];
  [k: string]: unknown;
}

/** Walk `GET /departments?parent_id=` from the roots into a nested tree. */
export async function buildDepartmentTree(ctx: RequestContext): Promise<unknown[]> {
  const asNodes = (v: unknown): DeptNode[] =>
    Array.isArray(v)
      ? (v as DeptNode[])
      : (((v as { entries?: DeptNode[] })?.entries ?? []) as DeptNode[]);
  const expand = async (parentId: string, depth: number): Promise<DeptNode[]> => {
    if (depth > 20) return []; // cycle guard
    const nodes = asNodes(await listDepartmentsSafe(ctx, parentId));
    for (const n of nodes) {
      if (n.id) n.children = await expand(n.id, depth + 1);
    }
    return nodes;
  };
  return expand("", 0);
}
