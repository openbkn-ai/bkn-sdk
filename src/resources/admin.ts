/** Admin (operator) resource surface. */
import {
  type AdminListOptions,
  type ListRolesOptions,
  type MemberType,
  getRole,
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
    userList: (opts?: AdminListOptions) => listUsers(ctx, opts),
    roleList: (opts?: ListRolesOptions) => listRoles(ctx, opts),
    roleGet: (roleId: string) => getRole(ctx, roleId),
    roleMembers: (roleId: string, opts?: { keyword?: string; limit?: number }) =>
      listRoleMembers(ctx, roleId, opts),
    addRoleMember: (roleId: string, id: string, type: MemberType = "user") =>
      modifyRoleMembers(ctx, roleId, "POST", [{ id, type }]),
    removeRoleMember: (roleId: string, id: string, type: MemberType = "user") =>
      modifyRoleMembers(ctx, roleId, "DELETE", [{ id, type }]),
  };
}
