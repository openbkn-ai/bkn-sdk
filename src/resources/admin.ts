// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import type {
  AdminListOptions,
  AuditListOptions,
  CreateOrgInput,
  CreateUserInput,
  ListRolesOptions,
  MemberType,
  OrgMembersOptions,
  UpdateOrgInput,
  UpdateUserInput,
} from "../api/admin.js";
import {
  USER_PAGE_MAX,
  activateLicenseSafe,
  assignRoleSafe,
  buildDepartmentTree,
  createDepartmentSafe,
  createRoleSafe,
  createUserSafe,
  deleteDepartmentSafe,
  deleteRoleSafe,
  deleteUserSafe,
  getAuditLogSafe,
  getDepartmentMembersSafe,
  getDepartmentSafe,
  getLicenseFingerprintSafe,
  getLicenseSafe,
  getRoleSafe,
  getUserRolesSafe,
  getUserSafe,
  importLicenseSafe,
  listAuditLogsSafe,
  listDepartmentsSafe,
  listRolesSafe,
  listUsersSafe,
  pageDirectory,
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
import { InputError } from "../utils/errors.js";

/**
 * Admin (operator) resource surface, on bkn-safe's token-gated
 * `/api/safe/v1/admin/*` API. See docs/exec-plans/admin-bkn-safe-migration.md.
 */

/** Slice `rows` by a client-side offset/limit; `total` counts rows before slicing. */
function pageRows<T>(rows: T[], offset?: number, limit?: number): { rows: T[]; total: number } {
  const start = Math.max(0, offset ?? 0);
  const end = limit === undefined ? undefined : start + Math.max(0, limit);
  return { rows: rows.slice(start, end), total: rows.length };
}

export function admin(ctx: RequestContext) {
  return {
    // ── departments ──
    orgList: (opts?: AdminListOptions) =>
      listDepartmentsSafe(ctx, { search: opts?.name, offset: opts?.offset, limit: opts?.limit }),
    orgGet: (deptId: string) => getDepartmentSafe(ctx, deptId),
    orgTree: () => buildDepartmentTree(ctx),
    orgMembers: async (deptId: string, opts: OrgMembersOptions = {}) => {
      const res = (await getDepartmentMembersSafe(ctx, deptId)) as { users?: unknown[] };
      if (opts.offset === undefined && opts.limit === undefined) return res;
      const { rows, total } = pageRows(res?.users ?? [], opts.offset, opts.limit);
      return { ...res, users: rows, total };
    },
    orgCreate: (input: CreateOrgInput) =>
      createDepartmentSafe(ctx, {
        name: input.name,
        parentId: input.parentId,
        managerId: input.managerID,
        code: input.code,
        remark: input.remark,
        email: input.email,
      }),
    orgUpdate: (deptId: string, input: UpdateOrgInput) =>
      updateDepartmentSafe(ctx, deptId, {
        name: input.name,
        managerId: input.managerID,
        code: input.code,
        remark: input.remark,
        email: input.email,
      }),
    orgDelete: (deptId: string) => deleteDepartmentSafe(ctx, deptId),

    // ── users ──
    userList: (opts?: AdminListOptions) =>
      listUsersSafe(ctx, {
        search: opts?.name,
        departmentId: opts?.orgId,
        offset: opts?.offset,
        limit: opts?.limit,
      }),
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
    userCreate: async (input: CreateUserInput) => {
      if (!input.password) {
        throw new InputError(
          "A new user needs an initial password: pass it explicitly (there is no default).",
        );
      }
      return createUserSafe(ctx, {
        account: input.loginName,
        password: input.password,
        name: input.displayName,
        email: input.email,
        telephone: input.telNumber,
        departmentIds: input.departmentIds,
      });
    },
    userUpdate: (userId: string, input: UpdateUserInput) =>
      updateUserSafe(ctx, userId, {
        name: input.displayName,
        email: input.email,
        telephone: input.telNumber,
        departmentIds: input.departmentIds,
      }),
    userDelete: (userId: string) => deleteUserSafe(ctx, userId),
    userResetPassword: (userId: string, newPassword: string) =>
      setUserPasswordSafe(ctx, userId, newPassword),

    // ── roles ──
    roleList: async (opts: ListRolesOptions = {}) => {
      // The endpoint filters only by source and returns every role; keyword and
      // paging are applied here. `total` counts matches before paging.
      const res = (await listRolesSafe(ctx, opts.source)) as {
        roles?: Array<{ id?: string; name?: string }>;
      };
      const keyword = opts.keyword?.trim().toLowerCase();
      const matched = (res.roles ?? []).filter(
        (r) =>
          !keyword ||
          (r.id ?? "").toLowerCase().includes(keyword) ||
          (r.name ?? "").toLowerCase().includes(keyword),
      );
      const offset = Math.max(0, opts.offset ?? 0);
      const end = opts.limit === undefined ? undefined : offset + Math.max(0, opts.limit);
      return { roles: matched.slice(offset, end), total: matched.length };
    },
    roleGet: (roleId: string) => getRoleSafe(ctx, roleId),
    roleMembers: async (roleId: string, opts: { offset?: number; limit?: number } = {}) => {
      // Members are accessor ids — enrich with account names from the user
      // list, paging until every member is named or the directory runs out.
      const mem = (await roleMembersSafe(ctx, roleId)) as { accessor_ids?: string[] };
      const { rows: ids, total } = pageRows(mem?.accessor_ids ?? [], opts.offset, opts.limit);
      const pending = new Set(ids);
      const nameById = new Map<string, string>();
      if (pending.size > 0) {
        await pageDirectory<{ id: string; account?: string; name?: string }>(
          (offset, limit) => listUsersSafe(ctx, { offset, limit }),
          "users",
          USER_PAGE_MAX,
          (users) => {
            for (const u of users) {
              if (!pending.has(u.id) || nameById.has(u.id)) continue;
              nameById.set(u.id, u.account ?? u.name ?? u.id);
            }
            return nameById.size >= pending.size;
          },
        );
      }
      return { members: ids.map((id) => ({ account: nameById.get(id) ?? id, id })), total };
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

    // ── audit trail (management mutations and token-gate refusals) ──
    auditList: (opts?: AuditListOptions) => listAuditLogsSafe(ctx, opts),
    auditGet: (id: string) => getAuditLogSafe(ctx, id),

    // ── license (cluster license hub; weak judgements — display/ops only) ──
    licenseGet: () => getLicenseSafe(ctx),
    licenseImport: (licenseText: string, opts?: { receipt?: boolean }) =>
      importLicenseSafe(ctx, licenseText, opts),
    licenseActivate: () => activateLicenseSafe(ctx),
    licenseRemove: () => removeLicenseSafe(ctx),
    licenseFingerprint: () => getLicenseFingerprintSafe(ctx),
  };
}
