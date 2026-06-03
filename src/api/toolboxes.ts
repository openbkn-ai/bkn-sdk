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
  return request(ctx, `${PATH}/list`, {
    query: { keyword: opts.keyword || undefined, limit: opts.limit, offset: opts.offset ?? 0 },
  });
}

/** List tools inside a toolbox. */
export function listTools(ctx: RequestContext, boxId: string): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/tools/list`);
}

export interface CreateToolboxOptions {
  name: string;
  serviceUrl: string;
  description?: string;
  source?: string;
}

export function createToolbox(ctx: RequestContext, opts: CreateToolboxOptions): Promise<unknown> {
  return request(ctx, PATH, {
    method: "POST",
    body: {
      metadata_type: "openapi",
      box_name: opts.name,
      box_desc: opts.description ?? "",
      box_svc_url: opts.serviceUrl,
      source: opts.source ?? "custom",
    },
  });
}

export function deleteToolbox(ctx: RequestContext, boxId: string): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}`, { method: "DELETE" });
}

/** Publish (status=published) or unpublish (status=draft) a toolbox. */
export function setToolboxStatus(
  ctx: RequestContext,
  boxId: string,
  status: "published" | "draft",
): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/status`, {
    method: "POST",
    body: { status },
  });
}

/** Enable/disable tools inside a toolbox. */
export function setToolStatuses(
  ctx: RequestContext,
  boxId: string,
  updates: Array<{ toolId: string; status: "enabled" | "disabled" }>,
): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/tools/status`, {
    method: "POST",
    body: updates.map((u) => ({ tool_id: u.toolId, status: u.status })),
  });
}
