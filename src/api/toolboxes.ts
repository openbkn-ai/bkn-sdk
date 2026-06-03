/**
 * Toolbox + tool client (agent-operator-integration tool-box). Read side,
 * mirroring kweaver-sdk api/toolboxes.ts. Passed through as parsed JSON.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const PATH = "/api/agent-operator-integration/v1/tool-box";

export interface ListToolboxesOptions {
  keyword?: string;
  limit?: number;
  offset?: number;
}

export function listToolboxes(
  ctx: RequestContext,
  opts: ListToolboxesOptions = {},
): Promise<unknown> {
  return request(ctx, PATH, {
    query: { keyword: opts.keyword || undefined, limit: opts.limit, offset: opts.offset ?? 0 },
  });
}

/** List tools inside a toolbox. */
export function listTools(ctx: RequestContext, boxId: string): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/tools/list`);
}
