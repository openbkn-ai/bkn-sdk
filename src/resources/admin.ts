/** Admin (operator) resource surface. */
import {
  type AdminListOptions,
  type AuditListOptions,
  type ListRolesOptions,
  type MemberType,
  getDepartment,
  getDepartmentMembers,
  getRole,
  getUser,
  getUserRoles,
  listAuditLogs,
  listDepartments,
  listRoleMembers,
  listRoles,
  listUsers,
  modifyRoleMembers,
} from "../api/admin.js";
import type { RequestContext } from "../types.js";

export function admin(ctx: RequestContext) {
  return {
    orgList: (opts?: AdminListOptions) => listDepartments(ctx, opts),
    orgGet: (deptId: string) => getDepartment(ctx, deptId),
    orgMembers: (deptId: string, opts?: { role?: string; offset?: number; limit?: number }) =>
      getDepartmentMembers(ctx, deptId, opts),
    userList: (opts?: AdminListOptions) => listUsers(ctx, opts),
    userGet: (userId: string) => getUser(ctx, userId),
    userRoles: (userId: string) => getUserRoles(ctx, userId),
    roleList: (opts?: ListRolesOptions) => listRoles(ctx, opts),
    roleGet: (roleId: string) => getRole(ctx, roleId),
    roleMembers: (roleId: string, opts?: { keyword?: string; limit?: number }) =>
      listRoleMembers(ctx, roleId, opts),
    addRoleMember: (roleId: string, id: string, type: MemberType = "user") =>
      modifyRoleMembers(ctx, roleId, "POST", [{ id, type }]),
    removeRoleMember: (roleId: string, id: string, type: MemberType = "user") =>
      modifyRoleMembers(ctx, roleId, "DELETE", [{ id, type }]),
    auditList: (opts?: AuditListOptions) => listAuditLogs(ctx, opts),
  };
}
