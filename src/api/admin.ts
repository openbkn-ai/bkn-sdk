// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Admin (operator) input shapes — the CLI-facing contract for the `admin`
 * command group. `src/resources/admin.ts` maps each of these onto the bkn-safe
 * client in `./safe.ts`, which is where the requests live.
 *
 * The ISF clients that used to back these types (`/api/user-management/v1`,
 * `/api/authorization/v1`, `/isfweb/api/ShareMgnt`, `/api/eacp/v1`) were removed
 * once ISF was retired — see docs/exec-plans/admin-bkn-safe-migration.md. Some
 * fields here are wider than bkn-safe accepts and are dropped in the mapping;
 * that lossiness is documented in the migration plan.
 */

export interface AdminListOptions {
  role?: string;
  offset?: number;
  limit?: number;
  name?: string;
  orgId?: string;
}

export interface ListRolesOptions {
  offset?: number;
  limit?: number;
  keyword?: string;
}

export interface CreateOrgInput {
  name: string;
  parentId?: string;
  managerID?: string | null;
  code?: string;
  remark?: string;
  status?: number;
  email?: string;
}

export interface UpdateOrgInput {
  name?: string;
  managerID?: string | null;
  code?: string;
  remark?: string;
  status?: number;
  email?: string;
}

export interface CreateUserInput {
  loginName: string;
  displayName?: string;
  email?: string;
  departmentIds?: string[];
  code?: string;
  position?: string;
  remark?: string;
  telNumber?: string;
  priority?: number;
  csfLevel?: number;
}

export interface UpdateUserInput {
  displayName?: string;
  code?: string;
  position?: string;
  remark?: string;
  email?: string;
  telNumber?: string;
  managerID?: string;
  priority?: number;
  csfLevel?: number;
}

export interface AuditListOptions {
  page?: number;
  size?: number;
  user?: string;
  start?: string;
  end?: string;
}

export type MemberType = "user" | "department" | "group" | "app";
