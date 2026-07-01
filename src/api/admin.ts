// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

import { decodeJwt } from "../auth/jwt.js";
/**
 * Admin (operator) client — user-management + authorization.
 * Reads and writes (org/user create/update/delete +
 * reset-password) implemented; org/user detail and writes go through ISFWeb
 * thrift where the REST routes are RegisterPrivate. Passed through as JSON.
 */
import type { RequestContext } from "../types.js";
import { HttpError } from "../utils/errors.js";
import { encryptModifyPwd } from "./eacp-crypto.js";
import { request } from "./http.js";

const UM = "/api/user-management/v1";
const AUTHZ = "/api/authorization/v1";
const ISFWEB = "/isfweb/api/ShareMgnt";

/**
 * The acting admin's UUID — required as a positional param by ShareMgnt user
 * writes. Prefer the JWT `sub` (id_token); when the token is opaque (Ory
 * `ory_at_…`), fall back to `GET /api/eacp/v1/user/get` (`userid`).
 */
async function callerUserId(ctx: RequestContext): Promise<string> {
  const sub = decodeJwt(ctx.token)?.sub;
  if (sub) return sub;
  const info = (await request(ctx, "/api/eacp/v1/user/get")) as { userid?: string };
  if (info?.userid) return info.userid;
  throw new Error(
    "Cannot resolve the caller user id (token has no JWT `sub` and " +
      "eacp/v1/user/get returned no `userid`). Re-login.",
  );
}

/**
 * ISFWeb thrift-style call: `POST /isfweb/api/ShareMgnt/<method>` with a
 * positional JSON array body. Business errors come back as HTTP 501 with
 * `{error:{errMsg,errID}}` — surface `errMsg` instead of "501 Not Implemented".
 */
async function shareMgnt(
  ctx: RequestContext,
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  try {
    return await request(ctx, `${ISFWEB}/${method}`, { method: "POST", body: params });
  } catch (e) {
    if (e instanceof HttpError) {
      try {
        const parsed = JSON.parse(e.body) as { error?: { errMsg?: string; errID?: number } };
        const err = parsed?.error;
        if (err?.errMsg) {
          const m = err.errID !== undefined ? `${err.errMsg} (errID=${err.errID})` : err.errMsg;
          throw new Error(`ShareMgnt.${method} failed: ${m}`);
        }
      } catch (inner) {
        if (inner instanceof Error && inner.message.startsWith("ShareMgnt.")) throw inner;
      }
    }
    throw e;
  }
}

const DEPT_FIELDS = "name,code,remark,manager,enabled,parent_deps,email";
const USER_FIELDS = "name,account,email,enabled,frozen,parent_deps,roles";

export interface AdminListOptions {
  role?: string;
  offset?: number;
  limit?: number;
  name?: string;
  orgId?: string;
}

/** Departments (org structure) via the console search route. */
export function listDepartments(
  ctx: RequestContext,
  opts: AdminListOptions = {},
): Promise<unknown> {
  return request(ctx, `${UM}/console/search-departments/${DEPT_FIELDS}`, {
    query: {
      role: opts.role ?? "super_admin",
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 100,
      name: opts.name || undefined,
    },
  });
}

export interface DeptEntry {
  id: string;
  name?: string;
  parent_deps?: Array<{ id: string; name?: string }>;
}

/** Fetch every department by paging the console search route (for tree building). */
export async function listAllDepartments(
  ctx: RequestContext,
  role = "super_admin",
  pageSize = 100,
): Promise<DeptEntry[]> {
  const out: DeptEntry[] = [];
  let offset = 0;
  for (;;) {
    const data = (await listDepartments(ctx, { role, offset, limit: pageSize })) as {
      total_count?: number;
      entries?: DeptEntry[];
    };
    const entries = data.entries ?? [];
    out.push(...entries);
    if (entries.length < pageSize) break;
    if (data.total_count !== undefined && out.length >= data.total_count) break;
    offset += pageSize;
  }
  return out;
}

/** Users via the console search route (REST `/users` 404s on every deploy). */
export function listUsers(ctx: RequestContext, opts: AdminListOptions = {}): Promise<unknown> {
  return request(ctx, `${UM}/console/search-users/${USER_FIELDS}`, {
    query: {
      role: opts.role ?? "super_admin",
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 100,
      department_id: opts.orgId || undefined,
      name: opts.name || undefined,
    },
  });
}

export interface ListRolesOptions {
  offset?: number;
  limit?: number;
  keyword?: string;
}

export function listRoles(ctx: RequestContext, opts: ListRolesOptions = {}): Promise<unknown> {
  return request(ctx, `${AUTHZ}/roles`, {
    query: {
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 100,
      keyword: opts.keyword || undefined,
    },
  });
}

export function getRole(ctx: RequestContext, roleId: string): Promise<unknown> {
  return request(ctx, `${AUTHZ}/roles/${encodeURIComponent(roleId)}`);
}

/**
 * One user's full info. UserManagement REST `/users/:id/:fields` rejects the
 * call (`invalid type` on `role`); the console uses ISFWeb thrift
 * `Usrm_GetUserInfo` with a positional `[id]` body, so we do the same.
 */
export function getUser(ctx: RequestContext, userId: string): Promise<unknown> {
  return shareMgnt(ctx, "Usrm_GetUserInfo", [userId]);
}

/**
 * Roles granted to a user. The Authorization `accessor_roles` route is
 * `RegisterPrivate` (404 on a public gateway); on 404 fall back to enumerating
 * roles and querying each role's members (cluster role counts are small).
 */
export async function getUserRoles(ctx: RequestContext, userId: string): Promise<unknown> {
  try {
    return await request(ctx, `${AUTHZ}/accessor_roles`, {
      query: { accessor_id: userId, accessor_type: "user" },
    });
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 404) throw e;
    const rolesPage = (await listRoles(ctx, { offset: 0, limit: 200 })) as {
      entries?: Array<{ id: string; name?: string; description?: string }>;
    };
    const roles = rolesPage.entries ?? [];
    const matched: Array<{ id: string; name?: string; description?: string }> = [];
    await Promise.all(
      roles.map(async (role) => {
        const members = (await listRoleMembers(ctx, role.id, { offset: 0, limit: 500 })) as {
          entries?: Array<{ id: string; type?: string }>;
        };
        if (
          (members.entries ?? []).some((m) => m.id === userId && (!m.type || m.type === "user"))
        ) {
          matched.push(role);
        }
      }),
    );
    return {
      entries: matched,
      total_count: matched.length,
      route: "fallback:list-roles+role-members",
    };
  }
}

/**
 * One department's full info. The REST `/departments/:id/:fields` route is
 * `RegisterPrivate` (404 on a public gateway), so go straight to ISFWeb thrift:
 * try `Usrm_GetOrgDepartmentById` (root-level orgs), fall back to
 * `Usrm_GetDepartmentById` (sub-departments) on a "not found"-style error.
 */
export async function getDepartment(ctx: RequestContext, deptId: string): Promise<unknown> {
  try {
    return await shareMgnt(ctx, "Usrm_GetOrgDepartmentById", [deptId]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/部门不存在|errID:?\s*20201|errID=?\s*99|NoneType.+subscriptable/i.test(msg)) throw e;
    return shareMgnt(ctx, "Usrm_GetDepartmentById", [deptId]);
  }
}

/** Members of a department (public route, fields default to `users`). */
export function getDepartmentMembers(
  ctx: RequestContext,
  deptId: string,
  opts: { role?: string; offset?: number; limit?: number } = {},
): Promise<unknown> {
  return request(ctx, `${UM}/department-members/${encodeURIComponent(deptId)}/users`, {
    query: { role: opts.role ?? "super_admin", offset: opts.offset ?? 0, limit: opts.limit ?? 100 },
  });
}

// ---- department writes (ISFWeb thrift) -------------------------------------

export interface CreateOrgInput {
  name: string;
  parentId?: string;
  managerID?: string | null;
  code?: string;
  remark?: string;
  status?: number;
  email?: string;
}

/** Create a department (`Usrm_AddDepartment`). Returns the new department id. */
export async function createDepartment(
  ctx: RequestContext,
  input: CreateOrgInput,
): Promise<unknown> {
  const ncTAddDepartParam = {
    parentId: input.parentId ?? "-1",
    departName: input.name,
    managerID: input.managerID ?? null,
    code: input.code ?? "",
    remark: input.remark ?? "",
    status: input.status ?? 1,
    email: input.email ?? "",
    ossId: "",
  };
  const id = await shareMgnt(ctx, "Usrm_AddDepartment", [{ ncTAddDepartParam }]);
  return { id };
}

export interface UpdateOrgInput {
  name?: string;
  managerID?: string | null;
  code?: string;
  remark?: string;
  status?: number;
  email?: string;
}

/** Update a department (`Usrm_EditDepartment`); only provided fields are sent. */
export async function updateDepartment(
  ctx: RequestContext,
  deptId: string,
  input: UpdateOrgInput,
): Promise<unknown> {
  const p: Record<string, unknown> = { departId: deptId };
  if (input.name !== undefined) p.departName = input.name;
  if (input.managerID !== undefined) p.managerID = input.managerID;
  if (input.code !== undefined) p.code = input.code;
  if (input.remark !== undefined) p.remark = input.remark;
  if (input.status !== undefined) p.status = input.status;
  if (input.email !== undefined) p.email = input.email;
  await shareMgnt(ctx, "Usrm_EditDepartment", [{ ncTEditDepartParam: p }]);
  return { id: deptId, updated: true };
}

/** Delete a department (`DELETE /management/departments/:id`). */
export async function deleteDepartment(ctx: RequestContext, deptId: string): Promise<unknown> {
  await request(ctx, `${UM}/management/departments/${encodeURIComponent(deptId)}`, {
    method: "DELETE",
  });
  return { id: deptId, deleted: true };
}

// ---- user writes -----------------------------------------------------------

export interface CreateUserInput {
  loginName: string;
  displayName?: string;
  email?: string;
  departmentIds?: string[];
  code?: string;
  position?: string;
  remark?: string;
  telNumber?: string;
  priority?: number;
  csfLevel?: number;
}

/**
 * Create a user (`Usrm_AddUser`). The thrift call does not accept a password —
 * the new user gets the platform default (forced change on first login).
 * Returns the new user id.
 */
export async function createUser(ctx: RequestContext, input: CreateUserInput): Promise<unknown> {
  const ncTUsrmUserInfo: Record<string, unknown> = {
    loginName: input.loginName,
    displayName: input.displayName ?? input.loginName,
    code: input.code ?? "",
    position: input.position ?? "",
    managerID: null,
    managerDisplayName: null,
    remark: input.remark ?? "",
    email: input.email ?? "",
    telNumber: input.telNumber ?? "",
    idcardNumber: "",
    departmentIds: input.departmentIds ?? ["-1"],
    priority: input.priority ?? 999,
    csfLevel2: null,
    pwdControl: false,
    expireTime: -1,
  };
  if (input.csfLevel !== undefined) ncTUsrmUserInfo.csfLevel = input.csfLevel;
  const id = await shareMgnt(ctx, "Usrm_AddUser", [
    { ncTUsrmAddUserInfo: { user: { ncTUsrmUserInfo } } },
    await callerUserId(ctx),
  ]);
  return { id };
}

export interface UpdateUserInput {
  displayName?: string;
  code?: string;
  position?: string;
  remark?: string;
  email?: string;
  telNumber?: string;
  managerID?: string;
  priority?: number;
  csfLevel?: number;
}

/**
 * Update mutable user fields. Tries the public REST route
 * `PATCH /management/users/:id` (snake_case body); on 404/405 falls back to
 * ISFWeb thrift `Usrm_EditUser` (needs the caller UUID).
 */
export async function updateUser(
  ctx: RequestContext,
  userId: string,
  input: UpdateUserInput,
): Promise<unknown> {
  const restBody: Record<string, unknown> = {};
  if (input.displayName !== undefined) restBody.display_name = input.displayName;
  if (input.code !== undefined) restBody.code = input.code;
  if (input.position !== undefined) restBody.position = input.position;
  if (input.remark !== undefined) restBody.remark = input.remark;
  if (input.email !== undefined) restBody.email = input.email;
  if (input.telNumber !== undefined) restBody.tel_number = input.telNumber;
  if (input.managerID !== undefined) restBody.manager_id = input.managerID;
  if (input.priority !== undefined) restBody.priority = input.priority;
  if (input.csfLevel !== undefined) restBody.csf_level = input.csfLevel;
  try {
    const r = await request(ctx, `${UM}/management/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: restBody,
    });
    return r ?? { id: userId, updated: true, route: "rest" };
  } catch (e) {
    if (!(e instanceof HttpError) || (e.status !== 404 && e.status !== 405)) throw e;
    const ncTEditUserParam = {
      id: userId,
      displayName: input.displayName ?? "",
      code: input.code ?? "",
      position: input.position ?? "",
      managerID: input.managerID ?? "",
      remark: input.remark ?? "",
      idcardNumber: null,
      priority: input.priority ?? 999,
      csfLevel: input.csfLevel ?? 5,
      csfLevel2: null,
      email: input.email ?? "",
      telNumber: input.telNumber ?? "",
      expireTime: -1,
    };
    await shareMgnt(ctx, "Usrm_EditUser", [{ ncTEditUserParam }, await callerUserId(ctx)]);
    return { id: userId, updated: true, route: "shareMgnt" };
  }
}

/** Delete a user (`DELETE /users/:id`, fallback ISFWeb thrift `Usrm_DelUser`). */
export async function deleteUser(ctx: RequestContext, userId: string): Promise<unknown> {
  try {
    await request(ctx, `${UM}/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 404) throw e;
    await shareMgnt(ctx, "Usrm_DelUser", [userId]);
  }
  return { id: userId, deleted: true };
}

/**
 * Admin reset of a user's password. RSA-PKCS1 encrypts the new password with
 * the built-in UserManagement key (`PUT /management/users/:id/password`).
 * No old password required for this admin route.
 */
export async function setUserPassword(
  ctx: RequestContext,
  userId: string,
  newPassword: string,
): Promise<unknown> {
  await request(ctx, `${UM}/management/users/${encodeURIComponent(userId)}/password`, {
    method: "PUT",
    body: { password: encryptModifyPwd(newPassword) },
  });
  return { id: userId, passwordReset: true };
}

const EACP = "/api/eacp/v1";

export interface AuditListOptions {
  page?: number;
  size?: number;
  user?: string;
  start?: string;
  end?: string;
}

/** Login audit events (EACP). */
export function listAuditLogs(ctx: RequestContext, opts: AuditListOptions = {}): Promise<unknown> {
  return request(ctx, `${EACP}/auth1/login-log`, {
    method: "POST",
    body: {
      page_num: opts.page ?? 1,
      page_size: opts.size ?? 30,
      user_name: opts.user || undefined,
      start_time: opts.start || undefined,
      end_time: opts.end || undefined,
    },
  });
}

/**
 * Self-service password change via EACP (`POST /api/eacp/v1/auth1/modifypassword`).
 * Both passwords are RSA-PKCS1 encrypted + base64 (same key as reset-password).
 */
export function changePassword(
  ctx: RequestContext,
  account: string,
  oldPassword: string,
  newPassword: string,
): Promise<unknown> {
  return request(ctx, `${EACP}/auth1/modifypassword`, {
    method: "POST",
    body: {
      account,
      oldpwd: encryptModifyPwd(oldPassword),
      newpwd: encryptModifyPwd(newPassword),
    },
  });
}

/**
 * Self-service password change on bkn-safe (`POST /api/safe/v1/auth/change-password`).
 * Plaintext over TLS, no token (it's a pre-login credential change). 204 on
 * success; 401 wrong account/old password; 400 new == old.
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

export type MemberType = "user" | "department" | "group" | "app";

export function listRoleMembers(
  ctx: RequestContext,
  roleId: string,
  opts: { offset?: number; limit?: number; keyword?: string } = {},
): Promise<unknown> {
  return request(ctx, `${AUTHZ}/role-members/${encodeURIComponent(roleId)}`, {
    query: {
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 100,
      keyword: opts.keyword || undefined,
    },
  });
}

/**
 * Add or remove role members. Both use POST; the verb is in the body
 * (`{method:"POST"|"DELETE", members:[{id,type}]}`).
 */
export function modifyRoleMembers(
  ctx: RequestContext,
  roleId: string,
  method: "POST" | "DELETE",
  members: Array<{ id: string; type: MemberType }>,
): Promise<unknown> {
  return request(ctx, `${AUTHZ}/role-members/${encodeURIComponent(roleId)}`, {
    method: "POST",
    body: { method, members },
  });
}
