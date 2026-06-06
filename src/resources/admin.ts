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
  createRoleSafe,
  createUserSafe,
  deleteDepartmentSafe,
  deleteRoleSafe,
  deleteUserSafe,
  getDepartmentMembersSafe,
  getDepartmentSafe,
  getRoleSafe,
  getUserRolesSafe,
  getUserSafe,
  listDepartmentsSafe,
  listRolesSafe,
  listUsersSafe,
  notOnSafe,
  removeRoleSafe,
  roleMembersSafe,
  setUserPasswordSafe,
  updateDepartmentSafe,
  updateRoleSafe,
  updateUserSafe,
} from "../api/safe.js";
import type { RequestContext } from "../types.js";

/**
 * Admin (operator) resource surface, on bkn-safe's token-gated
 * `/api/safe/v1/admin/*` API. Only `audit list` has no endpoint (login-log
 * retired by design) → `notOnSafe`. See
 * docs/exec-plans/admin-bkn-safe-migration.md.
 */
const DEFAULT_NEW_USER_PASSWORD = "openbkn"; // platform initial password (forced-change on first login)

export function admin(ctx: RequestContext) {
  return {
    // ── departments ──
    orgList: (opts?: AdminListOptions) =>
      listDepartmentsSafe(ctx, { search: opts?.name, offset: opts?.offset, limit: opts?.limit }),
    orgGet: (deptId: string) => getDepartmentSafe(ctx, deptId),
    orgTree: (_role?: string) => buildDepartmentTree(ctx),
    orgMembers: (deptId: string, _opts?: unknown) => getDepartmentMembersSafe(ctx, deptId),
    orgCreate: (input: CreateOrgInput) =>
      createDepartmentSafe(ctx, { name: input.name, parentId: input.parentId }),
    orgUpdate: (deptId: string, input: UpdateOrgInput) =>
      updateDepartmentSafe(ctx, deptId, { name: input.name }),
    orgDelete: (deptId: string) => deleteDepartmentSafe(ctx, deptId),

    // ── users ──
    userList: (opts?: AdminListOptions) =>
      listUsersSafe(ctx, { search: opts?.name, offset: opts?.offset, limit: opts?.limit }),
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
    roleList: (opts?: ListRolesOptions) => listRolesSafe(ctx),
    roleGet: (roleId: string) => getRoleSafe(ctx, roleId),
    roleMembers: (roleId: string, _opts?: unknown) => roleMembersSafe(ctx, roleId),
    addRoleMember: (roleId: string, id: string, _type: MemberType = "user") =>
      assignRoleSafe(ctx, id, roleId),
    removeRoleMember: (roleId: string, id: string, _type: MemberType = "user") =>
      removeRoleSafe(ctx, id, roleId),
    roleCreate: (name: string, description?: string) => createRoleSafe(ctx, { name, description }),
    roleUpdate: (roleId: string, input: { name?: string; description?: string }) =>
      updateRoleSafe(ctx, roleId, input),
    roleDelete: (roleId: string) => deleteRoleSafe(ctx, roleId),

    auditList: (_opts?: AuditListOptions) => notOnSafe("audit list"),
  };
}
