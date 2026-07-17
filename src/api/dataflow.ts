// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Dataflow backend client (automation v2). Read endpoints (list/runs/logs) are
 * implemented; trigger/create bodies are deferred until the
 * contract is verified on a live env. Responses passed through as parsed JSON.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const BASE = "/api/automation/v2";
const BASE_V1 = "/api/automation/v1";

export function listDataflows(ctx: RequestContext): Promise<unknown> {
  return request(ctx, `${BASE}/dags`, { query: { type: "data-flow", page: 0, limit: -1 } });
}

/** Create a dataflow (DAG) from a full document body. Returns the new DAG id. */
export function createDataflow(ctx: RequestContext, body: unknown): Promise<unknown> {
  return request(ctx, `${BASE_V1}/data-flow/flow`, { method: "POST", body });
}

/** Trigger a run of an existing dataflow DAG. */
export function runDataflow(ctx: RequestContext, dagId: string): Promise<unknown> {
  return request(ctx, `${BASE_V1}/run-instance/${encodeURIComponent(dagId)}`, {
    method: "POST",
    body: {},
  });
}

/** Delete a dataflow DAG. */
export function deleteDataflow(ctx: RequestContext, dagId: string): Promise<unknown> {
  return request(ctx, `${BASE_V1}/data-flow/flow/${encodeURIComponent(dagId)}`, {
    method: "DELETE",
  });
}

/**
 * Run a one-shot dataflow document to completion: create → run → poll the
 * latest result until success/failure → delete the DAG (always). Throws on a
 * failed run or timeout.
 */
export async function executeDataflow(
  ctx: RequestContext,
  body: unknown,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<unknown> {
  const created = (await createDataflow(ctx, body)) as { id?: string };
  const dagId = String(created.id ?? "");
  if (!dagId) throw new Error("createDataflow returned no DAG id");
  try {
    await runDataflow(ctx, dagId);
    const interval = opts.intervalMs ?? 2000;
    const deadline = opts.timeoutMs ?? 300_000;
    let waited = 0;
    for (;;) {
      const res = (await request(ctx, `${BASE_V1}/dag/${encodeURIComponent(dagId)}/results`)) as {
        results?: Array<{ status?: string }>;
      };
      const status = res.results?.[0]?.status;
      if (status === "success" || status === "completed") return { dagId, status };
      if (status === "failed" || status === "error") throw new Error(`Dataflow run ${status}`);
      if (waited >= deadline) throw new Error(`Dataflow run timed out after ${deadline}ms`);
      await new Promise((r) => setTimeout(r, interval));
      waited += interval;
    }
  } finally {
    await deleteDataflow(ctx, dagId).catch(() => {});
  }
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
