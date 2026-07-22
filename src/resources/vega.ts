// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import {
  type BuildTask,
  type CreateBuildTaskRequest,
  type CreateCatalogRequest,
  type DeleteBuildTasksOptions,
  type ListBuildTasksOptions,
  type ListCatalogsOptions,
  type RawQueryRequest,
  catalogHealthStatus,
  createBuildTask,
  createCatalog,
  deleteBuildTasks,
  deleteCatalog,
  disableCatalog,
  discoverCatalog,
  enableCatalog,
  getBuildTask,
  getCatalog,
  getConnectorType,
  listBuildTasks,
  listCatalogResources,
  listCatalogs,
  listConnectorTypes,
  runSql,
  startBuildTask,
  stopBuildTask,
  testCatalogConnection,
  updateCatalog,
} from "../api/vega.js";
/**
 * Vega resource surface — the exported SDK API for Catalog + index builds.
 * Knows nothing about argv or stdout; pure typed functions over `api/vega`.
 */
import type { RequestContext } from "../types.js";

const TERMINAL_STATES = new Set(["completed", "success", "failed", "stopped", "error"]);

export function vega(ctx: RequestContext) {
  return {
    catalogs: (opts?: ListCatalogsOptions) => listCatalogs(ctx, opts),
    getCatalog: (id: string) => getCatalog(ctx, id),
    createCatalog: (req: CreateCatalogRequest) => createCatalog(ctx, req),
    updateCatalog: (id: string, req: Partial<CreateCatalogRequest>) => updateCatalog(ctx, id, req),
    enableCatalog: (id: string) => enableCatalog(ctx, id),
    disableCatalog: (id: string) => disableCatalog(ctx, id),
    deleteCatalog: (id: string) => deleteCatalog(ctx, id),
    testCatalogConnection: (id: string) => testCatalogConnection(ctx, id),
    discoverCatalog: (id: string, wait = false) => discoverCatalog(ctx, id, wait),
    catalogResources: (id: string, category?: string, limit?: number, offset?: number) =>
      listCatalogResources(ctx, id, category, limit, offset),
    catalogHealth: (ids: string[]) => catalogHealthStatus(ctx, ids),
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
