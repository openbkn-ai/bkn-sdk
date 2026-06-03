/**
 * Vega backend client — catalog/resource reads + BuildTask (index build).
 * Build config lives on the task (CreateBuildTaskRequest), per the platform model.
 */
import { z } from "zod";
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

// NOTE: confirm the exact service base path against the live API (see
// docs/references/bkn-platform-api-llms.txt). Centralized here so it is a
// one-line change once verified.
const VEGA_BASE = "/api/vega/v1";

export const BuildMode = z.enum(["batch", "streaming"]);
export type BuildMode = z.infer<typeof BuildMode>;

/** POST /build-tasks body. */
export const CreateBuildTaskRequest = z.object({
  resource_id: z.string().min(1),
  mode: BuildMode,
  embedding_fields: z.array(z.string()).optional(),
  build_key_fields: z.array(z.string()).optional(),
  embedding_model: z.string().optional(),
  model_dimensions: z.number().int().positive().optional(),
});
export type CreateBuildTaskRequest = z.infer<typeof CreateBuildTaskRequest>;

export const BuildTask = z.object({
  id: z.string(),
  resource_id: z.string(),
  mode: BuildMode,
  state: z.string().optional(),
  synced_count: z.number().optional(),
  vectorized_count: z.number().optional(),
});
export type BuildTask = z.infer<typeof BuildTask>;

/** Create an index BuildTask for a resource. Returns the task (with its id). */
export async function createBuildTask(
  ctx: RequestContext,
  req: CreateBuildTaskRequest,
): Promise<BuildTask> {
  const body = CreateBuildTaskRequest.parse(req);
  const res = await request<unknown>(ctx, `${VEGA_BASE}/build-tasks`, { method: "POST", body });
  return BuildTask.parse(res);
}

/** Fetch a BuildTask's progress/state. */
export async function getBuildTask(ctx: RequestContext, taskId: string): Promise<BuildTask> {
  const res = await request<unknown>(ctx, `${VEGA_BASE}/build-tasks/${encodeURIComponent(taskId)}`);
  return BuildTask.parse(res);
}

export interface ListCatalogsOptions {
  limit?: number;
  offset?: number;
}

/** List catalog entries (raw passthrough — shape varies by backend). */
export async function listCatalogs(
  ctx: RequestContext,
  opts: ListCatalogsOptions = {},
): Promise<unknown> {
  return request(ctx, `${VEGA_BASE}/catalogs`, {
    query: { limit: opts.limit, offset: opts.offset },
  });
}
