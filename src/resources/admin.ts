// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

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
  activateLicenseSafe,
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
  getLicenseFingerprintSafe,
  getLicenseSafe,
  getRoleSafe,
  getUserRolesSafe,
  getUserSafe,
  importLicenseSafe,
  listDepartmentsSafe,
  listRolesSafe,
  listUsersSafe,
  notOnSafe,
  removeLicenseSafe,
  removeRoleSafe,
  roleMembersSafe,
  setRolePermissionSafe,
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
    userRoles: async (userId: string) => {
      // role-bindings returns ids only — enrich with names from the role list.
      const [bound, all] = await Promise.all([getUserRolesSafe(ctx, userId), listRolesSafe(ctx)]);
      const ids = (bound as { role_ids?: string[] }).role_ids ?? [];
      const nameById = new Map(
        ((all as { roles?: Array<{ id: string; name: string }> }).roles ?? []).map((r) => [
          r.id,
          r.name,
        ]),
      );
      return { roles: ids.map((id) => ({ name: nameById.get(id) ?? id, id })) };
    },
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
    roleList: (_opts?: ListRolesOptions) => listRolesSafe(ctx),
    roleGet: (roleId: string) => getRoleSafe(ctx, roleId),
    roleMembers: async (roleId: string, _opts?: unknown) => {
      // members are accessor ids — enrich with account names from the user list.
      const [mem, users] = await Promise.all([
        roleMembersSafe(ctx, roleId),
        listUsersSafe(ctx, { limit: 500 }),
      ]);
      const ids = (mem as { accessor_ids?: string[] }).accessor_ids ?? [];
      const nameById = new Map(
        (
          (users as { users?: Array<{ id: string; account?: string; name?: string }> }).users ?? []
        ).map((u) => [u.id, u.account ?? u.name ?? u.id] as const),
      );
      return { members: ids.map((id) => ({ account: nameById.get(id) ?? id, id })) };
    },
    addRoleMember: (roleId: string, id: string, _type: MemberType = "user") =>
      assignRoleSafe(ctx, id, roleId),
    removeRoleMember: (roleId: string, id: string, _type: MemberType = "user") =>
      removeRoleSafe(ctx, id, roleId),
    roleCreate: (name: string, description?: string) => createRoleSafe(ctx, { name, description }),
    roleUpdate: (roleId: string, input: { name?: string; description?: string }) =>
      updateRoleSafe(ctx, roleId, input),
    roleDelete: (roleId: string) => deleteRoleSafe(ctx, roleId),
    rolePermission: (
      roleId: string,
      grant: boolean,
      resourceType: string,
      resourceId: string,
      operations: string[],
    ) => setRolePermissionSafe(ctx, roleId, grant, { resourceType, resourceId, operations }),

    auditList: (_opts?: AuditListOptions) => notOnSafe("audit list"),

    // ── license (cluster license hub; weak judgements — display/ops only) ──
    licenseGet: () => getLicenseSafe(ctx),
    licenseImport: (licenseText: string, opts?: { receipt?: boolean }) =>
      importLicenseSafe(ctx, licenseText, opts),
    licenseActivate: () => activateLicenseSafe(ctx),
    licenseRemove: () => removeLicenseSafe(ctx),
    licenseFingerprint: () => getLicenseFingerprintSafe(ctx),
  };
}
