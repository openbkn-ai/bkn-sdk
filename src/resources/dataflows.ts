/** Dataflow resource surface (read side). */
import {
  type ListRunsOptions,
  type LogsOptions,
  getDataflowLogs,
  listDataflowRuns,
  listDataflows,
  runDataflowRemote,
} from "../api/dataflow.js";
import type { RequestContext } from "../types.js";

export function dataflows(ctx: RequestContext) {
  return {
    list: () => listDataflows(ctx),
    runs: (dagId: string, opts?: ListRunsOptions) => listDataflowRuns(ctx, dagId, opts),
    logs: (dagId: string, instanceId: string, opts?: LogsOptions) =>
      getDataflowLogs(ctx, dagId, instanceId, opts),
    run: (dagId: string, url: string, name: string) => runDataflowRemote(ctx, dagId, url, name),
  };
}
