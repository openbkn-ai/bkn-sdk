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
  createDepartmentSafe,
  createUserSafe,
  deleteDepartmentSafe,
  deleteUserSafe,
  getDepartmentSafe,
  getRoleSafe,
  getUserRolesSafe,
  getUserSafe,
  listDepartmentsSafe,
  listRolesSafe,
  notOnSafe,
  removeRoleSafe,
  roleMembersSafe,
  setUserPasswordSafe,
  updateDepartmentSafe,
  updateUserSafe,
} from "../api/safe.js";
import type { RequestContext } from "../types.js";

/**
 * Admin (operator) resource surface, on bkn-safe's `/api/safe/v1` API. Only
 * `user list` (no enumeration endpoint) and `audit list` (no audit endpoint)
 * have no bkn-safe equivalent — those throw a clear "not available" via
 * `notOnSafe`. See docs/exec-plans/admin-bkn-safe-migration.md.
 */
const DEFAULT_NEW_USER_PASSWORD = "openbkn"; // platform initial password (forced-change on first login)

export function admin(ctx: RequestContext) {
  return {
    // ── departments ──
    orgList: (_opts?: AdminListOptions) => listDepartmentsSafe(ctx),
    orgGet: (deptId: string) => getDepartmentSafe(ctx, deptId),
    orgTree: (_role?: string) => buildDepartmentTree(ctx),
    orgMembers: (_deptId: string, _opts?: unknown) => notOnSafe("org members"),
    orgCreate: (input: CreateOrgInput) =>
      createDepartmentSafe(ctx, { name: input.name, parentId: input.parentId }),
    orgUpdate: (deptId: string, input: UpdateOrgInput) =>
      updateDepartmentSafe(ctx, deptId, { name: input.name }),
    orgDelete: (deptId: string) => deleteDepartmentSafe(ctx, deptId),

    // ── users ──
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
    userUpdate: (userId: string, input: UpdateUserInput) =>
      updateUserSafe(ctx, userId, {
        name: input.displayName,
        email: input.email,
        telephone: input.telNumber,
      }),
    userDelete: (userId: string) => deleteUserSafe(ctx, userId),
    userResetPassword: (userId: string, newPassword: string) =>
      setUserPasswordSafe(ctx, userId, newPassword),

    // ── roles ──
    roleList: (opts?: ListRolesOptions) =>
      listRolesSafe(ctx, (opts as { source?: string } | undefined)?.source),
    roleGet: (roleId: string) => getRoleSafe(ctx, roleId),
    roleMembers: (roleId: string, _opts?: unknown) => roleMembersSafe(ctx, roleId),
    addRoleMember: (roleId: string, id: string, _type: MemberType = "user") =>
      assignRoleSafe(ctx, id, roleId),
    removeRoleMember: (roleId: string, id: string, _type: MemberType = "user") =>
      removeRoleSafe(ctx, id, roleId),

    auditList: (_opts?: AuditListOptions) => notOnSafe("audit list"),
  };
}
