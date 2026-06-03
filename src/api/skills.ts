/**
 * Skill registry/market client (agent-operator-integration). Read + delete,
 * mirroring kweaver-sdk api/skills.ts. Passed through as parsed JSON.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const BASE = "/api/agent-operator-integration/v1";

export interface ListSkillsOptions {
  page?: number;
  pageSize?: number;
  name?: string;
  source?: string;
  status?: string;
  createUser?: string;
}

function listQuery(opts: ListSkillsOptions) {
  return {
    page: opts.page ?? 1,
    page_size: opts.pageSize ?? 30,
    name: opts.name || undefined,
    source: opts.source || undefined,
    status: opts.status || undefined,
    create_user: opts.createUser || undefined,
  };
}

export function listSkills(ctx: RequestContext, opts: ListSkillsOptions = {}): Promise<unknown> {
  return request(ctx, `${BASE}/skills`, { query: listQuery(opts) });
}

export function listSkillMarket(
  ctx: RequestContext,
  opts: ListSkillsOptions = {},
): Promise<unknown> {
  return request(ctx, `${BASE}/skills/market`, { query: listQuery(opts) });
}

export function getSkill(ctx: RequestContext, skillId: string): Promise<unknown> {
  return request(ctx, `${BASE}/skills/${encodeURIComponent(skillId)}`);
}

export function getSkillMarket(ctx: RequestContext, skillId: string): Promise<unknown> {
  return request(ctx, `${BASE}/skills/market/${encodeURIComponent(skillId)}`);
}

export function deleteSkill(ctx: RequestContext, skillId: string): Promise<unknown> {
  return request(ctx, `${BASE}/skills/${encodeURIComponent(skillId)}`, { method: "DELETE" });
}
