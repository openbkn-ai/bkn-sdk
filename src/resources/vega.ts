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
  discoverResource,
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
  type ListConnectorTypesOptions,
  type RawQueryRequest,
  type UpdateCatalogRequest,
  catalogConnectorTypeStats,
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
  getIndexCapabilities,
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
import { InputError, WaitTimeoutError } from "../utils/errors.js";

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
    discoverResource: (resourceId: string) => discoverResource(ctx, resourceId),
    catalogResources: (id: string, category?: string, limit?: number, offset?: number) =>
      listCatalogResources(ctx, id, category, limit, offset),
    catalogHealth: (id: string) => catalogHealthStatus(ctx, id),
    catalogConnectorTypeStats: (opts?: { name?: string }) => catalogConnectorTypeStats(ctx, opts),
    connectorTypes: (opts?: ListConnectorTypesOptions) => listConnectorTypes(ctx, opts),
    connectorType: (type: string) => getConnectorType(ctx, type),
    indexCapabilities: () => getIndexCapabilities(ctx),

    /** Run SQL / OpenSearch DSL directly against a data source. */
    sql: (body: RawQueryRequest) => runSql(ctx, body),

    /**
     * Build a resource's index. With `wait`, polls until the task ends — see
     * {@link BuildWaitOptions} — and returns it in whatever state it ended in:
     * a `failed` task is returned, not thrown. Running out of time throws.
     */
    build: async (
      req: CreateBuildTaskRequest,
      opts: BuildWaitOptions & { wait?: boolean } = {},
    ): Promise<BuildTask> => {
      const task = await createBuildTask(ctx, req);
      if (!opts.wait) return task;
      return waitForBuildTask(ctx, task.id, opts);
    },

    buildStatus: (taskId: string) => getBuildTask(ctx, taskId),
    /** Wait for an existing BuildTask to end; same contract as `build({ wait })`. */
    waitForBuild: (taskId: string, opts: BuildWaitOptions = {}) =>
      waitForBuildTask(ctx, taskId, opts),
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

export interface BuildWaitOptions {
  /** Give up after this long (default 300s). `0` waits without a limit. */
  timeoutMs?: number;
  /** Poll interval (default 2s). */
  intervalMs?: number;
  /** Called with every state polled, the first included — for a progress display. */
  onProgress?: (task: BuildTask) => void;
}

/** A BuildTask's state, whichever of the two fields the response carried. */
export function buildTaskState(task: BuildTask): string {
  return (task.status ?? task.state ?? "").toLowerCase();
}

/** True once the task will change no further: succeeded, failed, or was stopped. */
export function isBuildTaskDone(task: BuildTask): boolean {
  return TERMINAL_STATES.has(buildTaskState(task));
}

/** True when the task ended without building the index. */
export function isBuildTaskUnsuccessful(task: BuildTask): boolean {
  return isBuildTaskDone(task) && !["completed", "success"].includes(buildTaskState(task));
}

async function waitForBuildTask(
  ctx: RequestContext,
  taskId: string,
  opts: BuildWaitOptions,
): Promise<BuildTask> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new InputError("timeoutMs must be a finite, non-negative number");
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new InputError("intervalMs must be a finite, non-negative number");
  }
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
  let last = await getBuildTask(ctx, taskId);
  opts.onProgress?.(last);
  while (!isBuildTaskDone(last)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      // Returning the task here would read as "done" to anyone who does not
      // re-check its status — which is how a timeout used to exit 0.
      throw new WaitTimeoutError(
        `BuildTask ${taskId} is still ${buildTaskState(last) || "in progress"} after ${Math.round(timeoutMs / 1000)}s. ` +
          `It keeps running on the server: \`openbkn vega build-task get ${taskId} --wait\` to keep waiting.`,
        last,
      );
    }
    // Use the whole wait budget, including a final poll after a shorter sleep.
    await sleep(Math.min(intervalMs, remainingMs));
    last = await getBuildTask(ctx, taskId);
    opts.onProgress?.(last);
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
