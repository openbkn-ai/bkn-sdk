/**
 * Admin (operator) client — user-management + authorization. Mirrors
 * kweaver-admin. List reads implemented; mutations stay in the command stubs
 * until tested against an operator env. Passed through as parsed JSON.
 *
 * NOTE: not yet validated against a live backend (operator endpoints need an
 * admin token); unit-tested with mocked fetch only.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const UM = "/api/user-management/v1";
const AUTHZ = "/api/authorization/v1";

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
