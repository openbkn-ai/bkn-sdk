/**
 * Vega-backend resource client (list/find/get/query/delete). Endpoints mirror
 * kweaver-sdk `api/resources.ts`. Responses passed through as parsed JSON.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const BASE = "/api/vega-backend/v1/resources";

export interface ListResourcesOptions {
  datasourceId?: string;
  name?: string;
  /** Resource category, e.g. table | logicview. */
  category?: string;
  limit?: number;
}

export function listResources(
  ctx: RequestContext,
  opts: ListResourcesOptions = {},
): Promise<unknown> {
  return request(ctx, BASE, {
    query: {
      catalog_id: opts.datasourceId || undefined,
      name: opts.name || undefined,
      category: opts.category || undefined,
      limit: opts.limit && opts.limit > 0 ? opts.limit : undefined,
    },
  });
}

export function getResource(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${BASE}/${encodeURIComponent(id)}`);
}

export function deleteResource(ctx: RequestContext, id: string): Promise<unknown> {
  return request(ctx, `${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface FindResourceOptions {
  datasourceId?: string;
  /** Exact name match instead of fuzzy. */
  exact?: boolean;
}

/** Search resources by name (fuzzy by default; exact filters client-side). */
export async function findResource(
  ctx: RequestContext,
  name: string,
  opts: FindResourceOptions = {},
): Promise<unknown> {
  const result = (await listResources(ctx, { name, datasourceId: opts.datasourceId })) as
    | { entries?: Array<{ name?: string }> }
    | Array<{ name?: string }>;
  const list = Array.isArray(result) ? result : (result.entries ?? []);
  return opts.exact ? list.filter((r) => r.name === name) : list;
}

export interface QueryResourceOptions {
  limit?: number;
  offset?: number;
  needTotal?: boolean;
}

export function queryResource(
  ctx: RequestContext,
  id: string,
  opts: QueryResourceOptions = {},
): Promise<unknown> {
  return request(ctx, `${BASE}/${encodeURIComponent(id)}/data`, {
    method: "POST",
    body: {
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
      need_total: opts.needTotal ?? false,
    },
  });
}
