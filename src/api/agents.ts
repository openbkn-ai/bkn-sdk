/**
 * Agent client (agent-factory v3). Read side + published listing, mirroring
 * kweaver-sdk api/agent-list.ts. Responses passed through as parsed JSON.
 * @deprecated The Decision Agent (agent-factory) surface is being phased out and
 * may be removed in a future release. Avoid building new integrations on it.
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

export function createAgent(ctx: RequestContext, body: unknown): Promise<unknown> {
  return request(ctx, `${BASE}/agent`, { method: "POST", body });
}

export function updateAgent(ctx: RequestContext, agentId: string, body: unknown): Promise<unknown> {
  return request(ctx, `${BASE}/agent/${encodeURIComponent(agentId)}`, { method: "PUT", body });
}

export function deleteAgent(ctx: RequestContext, agentId: string): Promise<unknown> {
  return request(ctx, `${BASE}/agent/${encodeURIComponent(agentId)}`, { method: "DELETE" });
}

export function publishAgent(ctx: RequestContext, agentId: string): Promise<unknown> {
  return request(ctx, `${BASE}/agent/${encodeURIComponent(agentId)}/publish`, { method: "POST" });
}

export function unpublishAgent(ctx: RequestContext, agentId: string): Promise<unknown> {
  return request(ctx, `${BASE}/agent/${encodeURIComponent(agentId)}/unpublish`, { method: "PUT" });
}

const APP = "/api/agent-factory/v1/app";

/** List conversations (sessions) for an agent. `agentKey` is the agent's key. */
export function listConversations(
  ctx: RequestContext,
  agentKey: string,
  opts: { page?: number; size?: number } = {},
): Promise<unknown> {
  return request(ctx, `${APP}/${encodeURIComponent(agentKey)}/conversation`, {
    query: { page: opts.page ?? 1, size: opts.size ?? 30 },
  });
}

/** Message history for one conversation. */
export function listMessages(
  ctx: RequestContext,
  agentKey: string,
  conversationId: string,
): Promise<unknown> {
  return request(
    ctx,
    `${APP}/${encodeURIComponent(agentKey)}/conversation/${encodeURIComponent(conversationId)}`,
  );
}
