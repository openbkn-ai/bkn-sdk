/**
 * Agent client (agent-factory v3). Read side + published listing, mirroring
 * kweaver-sdk api/agent-list.ts. Responses passed through as parsed JSON.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const BASE = "/api/agent-factory/v3";

export interface ListAgentsOptions {
  name?: string;
  offset?: number;
  limit?: number;
  categoryId?: string;
  customSpaceId?: string;
  isToSquare?: number;
}

/** Published agents (POST with a paging/filter body). */
export function listAgents(ctx: RequestContext, opts: ListAgentsOptions = {}): Promise<unknown> {
  return request(ctx, `${BASE}/published/agent`, {
    method: "POST",
    body: {
      offset: opts.offset ?? 0,
      limit: opts.limit ?? 30,
      category_id: opts.categoryId ?? "",
      name: opts.name ?? "",
      custom_space_id: opts.customSpaceId ?? "",
      is_to_square: opts.isToSquare ?? 1,
    },
  });
}

export function getAgent(ctx: RequestContext, agentId: string): Promise<unknown> {
  return request(ctx, `${BASE}/agent/${encodeURIComponent(agentId)}`);
}

export function getAgentByKey(ctx: RequestContext, key: string): Promise<unknown> {
  return request(ctx, `${BASE}/agent/by-key/${encodeURIComponent(key)}`);
}

export interface PagingOptions {
  offset?: number;
  limit?: number;
  name?: string;
}

export function listPersonalAgents(
  ctx: RequestContext,
  opts: PagingOptions = {},
): Promise<unknown> {
  return request(ctx, `${BASE}/personal-space/agent-list`, {
    query: { offset: opts.offset ?? 0, limit: opts.limit ?? 30, name: opts.name || undefined },
  });
}

export function listAgentTemplates(
  ctx: RequestContext,
  opts: PagingOptions = {},
): Promise<unknown> {
  return request(ctx, `${BASE}/published/agent-tpl`, {
    query: { offset: opts.offset ?? 0, limit: opts.limit ?? 30, name: opts.name || undefined },
  });
}

export function getAgentTemplate(ctx: RequestContext, templateId: string): Promise<unknown> {
  return request(ctx, `${BASE}/published/agent-tpl/${encodeURIComponent(templateId)}`);
}

export function listAgentCategories(ctx: RequestContext): Promise<unknown> {
  return request(ctx, `${BASE}/category`);
}
