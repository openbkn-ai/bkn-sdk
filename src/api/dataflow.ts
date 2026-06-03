/**
 * Dataflow backend client (automation v2). Read endpoints (list/runs/logs) are
 * implemented from kweaver-sdk; trigger/create bodies are deferred until the
 * contract is verified on a live env. Responses passed through as parsed JSON.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const BASE = "/api/automation/v2";

export function listDataflows(ctx: RequestContext): Promise<unknown> {
  return request(ctx, `${BASE}/dags`, { query: { type: "data-flow", page: 0, limit: -1 } });
}

export interface ListRunsOptions {
  since?: string;
}

export function listDataflowRuns(
  ctx: RequestContext,
  dagId: string,
  opts: ListRunsOptions = {},
): Promise<unknown> {
  return request(ctx, `${BASE}/dag/${encodeURIComponent(dagId)}/results`, {
    query: { since: opts.since || undefined },
  });
}

export interface LogsOptions {
  page?: number;
  limit?: number;
}

/** Trigger a dataflow run from a remote file URL. */
export function runDataflowRemote(
  ctx: RequestContext,
  dagId: string,
  url: string,
  name: string,
): Promise<unknown> {
  return request(ctx, `${BASE}/dataflow-doc/trigger/${encodeURIComponent(dagId)}`, {
    method: "POST",
    body: { source_from: "remote", url, name },
  });
}

export function getDataflowLogs(
  ctx: RequestContext,
  dagId: string,
  instanceId: string,
  opts: LogsOptions = {},
): Promise<unknown> {
  return request(
    ctx,
    `${BASE}/dag/${encodeURIComponent(dagId)}/result/${encodeURIComponent(instanceId)}`,
    { query: { page: opts.page ?? 0, limit: opts.limit ?? 30 } },
  );
}
