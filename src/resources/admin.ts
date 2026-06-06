import type {
  AdminListOptions,
  AuditListOptions,
  CreateOrgInput,
  CreateUserInput,
  ListRolesOptions,
  MemberType,
  UpdateOrgInput,
  UpdateUserInput,
} from "../api/admin.js";
import {
  assignRoleSafe,
  buildDepartmentTree,
  createUserSafe,
  getDepartmentSafe,
  getUserRolesSafe,
  getUserSafe,
  listDepartmentsSafe,
  notOnSafe,
  setUserPasswordSafe,
} from "../api/safe.js";
import type { RequestContext } from "../types.js";

/**
 * Admin (operator) resource surface, on bkn-safe's `/api/safe/v1` API. bkn-safe
 * owns a minimal identity surface, so several ISF-era operations have no
 * endpoint — those throw a clear "not available" via `notOnSafe` instead of a
 * raw 503. See docs/exec-plans/admin-bkn-safe-migration.md.
 */
const DEFAULT_NEW_USER_PASSWORD = "openbkn"; // platform initial password (forced-change on first login)

export function admin(ctx: RequestContext) {
  return {
    // ── departments (read-only on bkn-safe) ──
    orgList: (_opts?: AdminListOptions) => listDepartmentsSafe(ctx),
    orgGet: (deptId: string) => getDepartmentSafe(ctx, deptId),
    orgTree: (_role?: string) => buildDepartmentTree(ctx),
    orgMembers: (_deptId: string, _opts?: unknown) => notOnSafe("org members"),
    orgCreate: (_input: CreateOrgInput) => notOnSafe("org create"),
    orgUpdate: (_deptId: string, _input: UpdateOrgInput) => notOnSafe("org update"),
    orgDelete: (_deptId: string) => notOnSafe("org delete"),

    // ── users (get/create/set-password + roles; no enumerate/update/delete) ──
    userList: (_opts?: AdminListOptions) => notOnSafe("user list"),
    userGet: (userId: string) => getUserSafe(ctx, userId),
    userRoles: (userId: string) => getUserRolesSafe(ctx, userId),
    userCreate: (input: CreateUserInput) =>
      createUserSafe(ctx, {
        account: input.loginName,
        password: DEFAULT_NEW_USER_PASSWORD,
        name: input.displayName,
        email: input.email,
      }),
    userUpdate: (_userId: string, _input: UpdateUserInput) => notOnSafe("user update"),
    userDelete: (_userId: string) => notOnSafe("user delete"),
    userResetPassword: (userId: string, newPassword: string) =>
      setUserPasswordSafe(ctx, userId, newPassword),

    // ── roles (bind only; no enumerate/unbind) ──
    roleList: (_opts?: ListRolesOptions) => notOnSafe("role list"),
    roleGet: (_roleId: string) => notOnSafe("role get"),
    roleMembers: (_roleId: string, _opts?: unknown) => notOnSafe("role members"),
    addRoleMember: (roleId: string, id: string, _type: MemberType = "user") =>
      assignRoleSafe(ctx, id, roleId),
    removeRoleMember: (_roleId: string, _id: string, _type: MemberType = "user") =>
      notOnSafe("role remove-member"),

    auditList: (_opts?: AuditListOptions) => notOnSafe("audit list"),
  };
}
