import type { RequestContext } from "../types.js";
/**
 * Skill registry/market client (agent-operator-integration). Read + delete,
 * mirroring kweaver-sdk api/skills.ts. Passed through as parsed JSON.
 */
import { HttpError } from "../utils/errors.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { applyTls } from "./tls.js";

const BASE = "/api/agent-operator-integration/v1";

/** Register a skill from a zip archive (multipart `file_type=zip`). */
export async function registerSkillZip(
  ctx: RequestContext,
  bytes: Uint8Array,
  opts: { filename?: string; source?: string; extendInfo?: unknown } = {},
): Promise<unknown> {
  applyTls(ctx);
  const form = new FormData();
  form.set("file_type", "zip");
  form.set("file", new Blob([bytes]), opts.filename ?? "skill.zip");
  if (opts.source) form.set("source", opts.source);
  if (opts.extendInfo) form.set("extend_info", JSON.stringify(opts.extendInfo));
  const res = await fetch(`${ctx.baseUrl}${BASE}/skills`, {
    method: "POST",
    headers: buildHeaders(ctx),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, res.statusText, text);
  return text ? JSON.parse(text) : undefined;
}

/** Update a skill's package from a zip archive (multipart PUT). */
export async function updateSkillPackageZip(
  ctx: RequestContext,
  skillId: string,
  bytes: Uint8Array,
  filename = "skill.zip",
): Promise<unknown> {
  applyTls(ctx);
  const form = new FormData();
  form.set("file_type", "zip");
  form.set("file", new Blob([bytes]), filename);
  const res = await fetch(`${ctx.baseUrl}${BASE}/skills/${encodeURIComponent(skillId)}/package`, {
    method: "PUT",
    headers: buildHeaders(ctx),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, res.statusText, text);
  return text ? JSON.parse(text) : undefined;
}

/** Download a skill as a zip archive (raw bytes). */
export async function downloadSkill(ctx: RequestContext, skillId: string): Promise<Uint8Array> {
  applyTls(ctx);
  const res = await fetch(`${ctx.baseUrl}${BASE}/skills/${encodeURIComponent(skillId)}/download`, {
    headers: buildHeaders(ctx),
  });
  if (!res.ok) throw new HttpError(res.status, res.statusText, await res.text());
  return new Uint8Array(await res.arrayBuffer());
}

/** Update a skill's editable metadata (JSON PUT). */
export function updateSkillMetadata(
  ctx: RequestContext,
  skillId: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, `${BASE}/skills/${encodeURIComponent(skillId)}`, { method: "PUT", body });
}

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

/** Read a skill's SKILL.md content index. */
export function getSkillContent(ctx: RequestContext, skillId: string): Promise<unknown> {
  return request(ctx, `${BASE}/skills/${encodeURIComponent(skillId)}/content`);
}

/** Read a file inside a skill (progressive). */
export function readSkillFile(
  ctx: RequestContext,
  skillId: string,
  relPath: string,
): Promise<unknown> {
  return request(ctx, `${BASE}/skills/${encodeURIComponent(skillId)}/files/read`, {
    method: "POST",
    body: { rel_path: relPath },
  });
}

/** Version history for a skill. */
export function getSkillHistory(ctx: RequestContext, skillId: string): Promise<unknown> {
  return request(ctx, `${BASE}/skills/${encodeURIComponent(skillId)}/history`);
}

export type SkillStatus = "unpublish" | "published" | "offline";

/** Change a skill's status. */
export function setSkillStatus(
  ctx: RequestContext,
  skillId: string,
  status: SkillStatus,
): Promise<unknown> {
  return request(ctx, `${BASE}/skills/${encodeURIComponent(skillId)}/status`, {
    method: "PUT",
    body: { status },
  });
}
