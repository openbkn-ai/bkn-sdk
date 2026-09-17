// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Admin (operator) input shapes — the CLI-facing contract for the `admin`
 * command group. `src/resources/admin.ts` maps each of these onto the bkn-safe
 * client in `./safe.ts`, which is where the requests live.
 *
 * Every field here reaches bkn-safe `/api/safe/v1/admin/*`. The retired ISF
 * fields that bkn-safe has no column for (org status, user code/position/
 * remark/priority/confidentiality level) were removed rather than accepted and
 * dropped.
 */

export interface AdminListOptions {
  offset?: number;
  limit?: number;
  /** Account/name substring. */
  name?: string;
  /** Users only: direct members of this department. */
  orgId?: string;
}

export interface ListRolesOptions {
  offset?: number;
  limit?: number;
  keyword?: string;
  source?: string;
}

export interface CreateOrgInput {
  name: string;
  parentId?: string;
  managerID?: string;
  code?: string;
  remark?: string;
  email?: string;
}

export interface UpdateOrgInput {
  name?: string;
  managerID?: string;
  code?: string;
  remark?: string;
  email?: string;
}

export interface CreateUserInput {
  loginName: string;
  /** Initial password; the user must change it on first login. Required. */
  password: string;
  displayName?: string;
  email?: string;
  telNumber?: string;
  departmentIds?: string[];
}

export interface UpdateUserInput {
  displayName?: string;
  email?: string;
  telNumber?: string;
  /** Replaces the user's department membership. */
  departmentIds?: string[];
}

/** Direct members of a department, paged client-side (the route returns all of them). */
export interface OrgMembersOptions {
  offset?: number;
  limit?: number;
}

/** Audit list filters — the bkn-safe `GET /admin/audit-logs` query. */
export type { AuditLogQuery as AuditListOptions } from "./safe.js";

export type MemberType = "user" | "department" | "group" | "app";
