import {
  type BuildTask,
  type CreateBuildTaskRequest,
  type ListCatalogsOptions,
  catalogHealthStatus,
  createBuildTask,
  getBuildTask,
  getCatalog,
  getConnectorType,
  listCatalogResources,
  listCatalogs,
  listConnectorTypes,
} from "../api/vega.js";
/**
 * Vega resource surface — the exported SDK API for Catalog + index builds.
 * Knows nothing about argv or stdout; pure typed functions over `api/vega`.
 */
import type { RequestContext } from "../types.js";

const TERMINAL_STATES = new Set(["completed", "success", "failed"]);

export function vega(ctx: RequestContext) {
  return {
    catalogs: (opts?: ListCatalogsOptions) => listCatalogs(ctx, opts),
    getCatalog: (id: string) => getCatalog(ctx, id),
    catalogResources: (id: string, category?: string) => listCatalogResources(ctx, id, category),
    catalogHealth: (ids: string[]) => catalogHealthStatus(ctx, ids),
    connectorTypes: () => listConnectorTypes(ctx),
    connectorType: (type: string) => getConnectorType(ctx, type),

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
  };
}

async function pollBuildTask(
  ctx: RequestContext,
  taskId: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<BuildTask> {
  const deadline = Date.now() + timeoutMs;
  let last = await getBuildTask(ctx, taskId);
  while (!TERMINAL_STATES.has((last.state ?? "").toLowerCase()) && Date.now() < deadline) {
    await sleep(intervalMs);
    last = await getBuildTask(ctx, taskId);
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
