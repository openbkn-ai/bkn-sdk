// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import {
  type CreateDiscoverScheduleRequest,
  type DeleteDiscoverTasksOptions,
  type ListDiscoverSchedulesOptions,
  type ListDiscoverTasksOptions,
  type UpdateDiscoverScheduleRequest,
  createDiscoverSchedule,
  deleteDiscoverSchedule,
  deleteDiscoverTasks,
  disableDiscoverSchedule,
  discoverCatalog,
  enableDiscoverSchedule,
  getDiscoverSchedule,
  getDiscoverTask,
  listDiscoverSchedules,
  listDiscoverTasks,
  updateDiscoverSchedule,
} from "../api/vega-discovery.js";
import {
  type CreateSemanticUnderstandingTaskRequest,
  type DeleteSemanticUnderstandingTasksOptions,
  type ListSemanticUnderstandingTasksOptions,
  createSemanticUnderstandingTask,
  deleteSemanticUnderstandingTasks,
  getSemanticUnderstandingTask,
  listSemanticUnderstandingTasks,
} from "../api/vega-semantic.js";
import {
  type BuildTask,
  type CatalogConnectionTestRequest,
  type CatalogHealthCheckScheduleRequest,
  type CatalogWriteOptions,
  type CreateBuildTaskRequest,
  type CreateCatalogRequest,
  type DeleteBuildTasksOptions,
  type DeleteCatalogOptions,
  type ListBuildTasksOptions,
  type ListCatalogsOptions,
  type RawQueryRequest,
  type UpdateCatalogRequest,
  catalogHealthStatus,
  createBuildTask,
  createCatalog,
  deleteBuildTasks,
  deleteCatalog,
  disableCatalog,
  enableCatalog,
  getBuildTask,
  getCatalog,
  getCatalogHealthCheckSchedule,
  getConnectorType,
  listBuildTasks,
  listCatalogResources,
  listCatalogs,
  listConnectorTypes,
  runSql,
  startBuildTask,
  stopBuildTask,
  testCatalogConnection,
  testCatalogConnectionConfig,
  updateCatalog,
  updateCatalogHealthCheckSchedule,
} from "../api/vega.js";
/**
 * Vega resource surface — the exported SDK API for Catalog + index builds.
 * Knows nothing about argv or stdout; pure typed functions over `api/vega`.
 */
import type { RequestContext } from "../types.js";

const TERMINAL_STATES = new Set([
  "completed",
  "success",
  "failed",
  "stopped",
  "cancelled",
  "error",
]);

export function vega(ctx: RequestContext) {
  return {
    catalogs: (opts?: ListCatalogsOptions) => listCatalogs(ctx, opts),
    getCatalog: (id: string | string[]) => getCatalog(ctx, id),
    createCatalog: (req: CreateCatalogRequest, opts?: CatalogWriteOptions) =>
      createCatalog(ctx, req, opts),
    updateCatalog: (id: string, req: UpdateCatalogRequest, opts?: CatalogWriteOptions) =>
      updateCatalog(ctx, id, req, opts),
    enableCatalog: (id: string) => enableCatalog(ctx, id),
    disableCatalog: (id: string) => disableCatalog(ctx, id),
    deleteCatalog: <T extends DeleteCatalogOptions | undefined = undefined>(id: string, opts?: T) =>
      deleteCatalog(ctx, id, opts),
    testCatalogConnectionConfig: (req: CatalogConnectionTestRequest) =>
      testCatalogConnectionConfig(ctx, req),
    testCatalogConnection: (id: string) => testCatalogConnection(ctx, id),
    catalogHealthCheckSchedule: (id: string) => getCatalogHealthCheckSchedule(ctx, id),
    updateCatalogHealthCheckSchedule: (id: string, req: CatalogHealthCheckScheduleRequest) =>
      updateCatalogHealthCheckSchedule(ctx, id, req),
    discoverCatalog: (catalogId: string, req?: Parameters<typeof discoverCatalog>[2]) =>
      discoverCatalog(ctx, catalogId, req),
    catalogResources: (id: string, category?: string, limit?: number, offset?: number) =>
      listCatalogResources(ctx, id, category, limit, offset),
    catalogHealth: (id: string) => catalogHealthStatus(ctx, id),
    connectorTypes: () => listConnectorTypes(ctx),
    connectorType: (type: string) => getConnectorType(ctx, type),

    /** Run SQL / OpenSearch DSL directly against a data source. */
    sql: (body: RawQueryRequest) => runSql(ctx, body),

    /** Build a resource's index. With `wait`, polls until terminal. */
    build: async (
      req: CreateBuildTaskRequest,
      opts: { wait?: boolean; timeoutMs?: number; intervalMs?: number } = {},
    ): Promise<BuildTask> => {
      const task = await createBuildTask(ctx, req);
      if (!opts.wait) return task;
      return pollBuildTask(ctx, task.id, opts.timeoutMs ?? 300_000, opts.intervalMs ?? 2_000);
    },

    buildStatus: (taskId: string) => getBuildTask(ctx, taskId),
    buildTasks: (opts?: ListBuildTasksOptions) => listBuildTasks(ctx, opts),
    deleteBuildTasks: (ids: string[], opts?: DeleteBuildTasksOptions) =>
      deleteBuildTasks(ctx, ids, opts),
    startBuildTask: (taskId: string, opts?: { reset?: boolean }) =>
      startBuildTask(ctx, taskId, opts),
    stopBuildTask: (taskId: string) => stopBuildTask(ctx, taskId),

    discoverSchedules: (opts?: ListDiscoverSchedulesOptions) => listDiscoverSchedules(ctx, opts),
    getDiscoverSchedule: (id: string) => getDiscoverSchedule(ctx, id),
    createDiscoverSchedule: (req: CreateDiscoverScheduleRequest) =>
      createDiscoverSchedule(ctx, req),
    updateDiscoverSchedule: (id: string, req: UpdateDiscoverScheduleRequest) =>
      updateDiscoverSchedule(ctx, id, req),
    deleteDiscoverSchedule: (id: string) => deleteDiscoverSchedule(ctx, id),
    enableDiscoverSchedule: (id: string) => enableDiscoverSchedule(ctx, id),
    disableDiscoverSchedule: (id: string) => disableDiscoverSchedule(ctx, id),

    discoverTasks: (opts?: ListDiscoverTasksOptions) => listDiscoverTasks(ctx, opts),
    getDiscoverTask: (id: string) => getDiscoverTask(ctx, id),
    deleteDiscoverTasks: (ids: string | string[], opts?: DeleteDiscoverTasksOptions) =>
      deleteDiscoverTasks(ctx, ids, opts),

    createSemanticUnderstandingTask: (req: CreateSemanticUnderstandingTaskRequest) =>
      createSemanticUnderstandingTask(ctx, req),
    semanticUnderstandingTasks: (opts?: ListSemanticUnderstandingTasksOptions) =>
      listSemanticUnderstandingTasks(ctx, opts),
    getSemanticUnderstandingTask: (id: string) => getSemanticUnderstandingTask(ctx, id),
    deleteSemanticUnderstandingTasks: (
      ids: string | string[],
      opts?: DeleteSemanticUnderstandingTasksOptions,
    ) => deleteSemanticUnderstandingTasks(ctx, ids, opts),
  };
}

async function pollBuildTask(
  ctx: RequestContext,
  taskId: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<BuildTask> {
  const deadline = Date.now() + timeoutMs;
  const terminal = (t: BuildTask) => TERMINAL_STATES.has((t.status ?? t.state ?? "").toLowerCase());
  let last = await getBuildTask(ctx, taskId);
  while (!terminal(last) && Date.now() < deadline) {
    await sleep(intervalMs);
    last = await getBuildTask(ctx, taskId);
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
