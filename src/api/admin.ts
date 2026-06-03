import type { RequestContext } from "../types.js";
/**
 * Admin (operator) client — user-management + authorization. Mirrors
 * kweaver-admin. List reads implemented; mutations stay in the command stubs
 * until tested against an operator env. Passed through as parsed JSON.
 *
 * NOTE: not yet validated against a live backend (operator endpoints need an
 * admin token); unit-tested with mocked fetch only.
 */
import { HttpError } from "../utils/errors.js";
import { request } from "./http.js";

const UM = "/api/user-management/v1";
const AUTHZ = "/api/authorization/v1";
const ISFWEB = "/isfweb/api/ShareMgnt";

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
