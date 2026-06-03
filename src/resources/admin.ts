/** Admin (operator) resource surface. */
import {
  type AdminListOptions,
  type ListRolesOptions,
  getRole,
  listDepartments,
  listRoles,
  listUsers,
} from "../api/admin.js";
import type { RequestContext } from "../types.js";

export function admin(ctx: RequestContext) {
  return {
    orgList: (opts?: AdminListOptions) => listDepartments(ctx, opts),
    userList: (opts?: AdminListOptions) => listUsers(ctx, opts),
    roleList: (opts?: ListRolesOptions) => listRoles(ctx, opts),
    roleGet: (roleId: string) => getRole(ctx, roleId),
  };
}
