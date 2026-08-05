// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import type { RequestContext } from "../types.js";
/**
 * Skill registry/market client (agent-operator-integration). Read + delete.
 * Passed through as parsed JSON.
 */
import { HttpError } from "../utils/errors.js";
import { authFetch } from "./auth-fetch.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { tlsFetch } from "./tls.js";

const BASE = "/api/agent-operator-integration/v1";

/** Register a skill from a zip archive (multipart `file_type=zip`). */
export async function registerSkillZip(
  ctx: RequestContext,
  bytes: Uint8Array,
  opts: { filename?: string; source?: string; extendInfo?: unknown } = {},
): Promise<unknown> {
  const form = new FormData();
  form.set("file_type", "zip");
  form.set("file", new Blob([bytes]), opts.filename ?? "skill.zip");
  if (opts.source) form.set("source", opts.source);
  if (opts.extendInfo) form.set("extend_info", JSON.stringify(opts.extendInfo));
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx.insecure, `${ctx.baseUrl}${BASE}/skills`, {
      method: "POST",
      headers: buildHeaders(ctx),
      body: form,
    }),
  );
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
  const form = new FormData();
  form.set("file_type", "zip");
  form.set("file", new Blob([bytes]), filename);
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx.insecure, `${ctx.baseUrl}${BASE}/skills/${encodeURIComponent(skillId)}/package`, {
      method: "PUT",
      headers: buildHeaders(ctx),
      body: form,
    }),
  );
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, res.statusText, text);
  return text ? JSON.parse(text) : undefined;
}

/**
 * Which side of the skill API to read.
 *
 * The consumer surface serves the **published** release; the management surface
 * serves the **draft** (current) version and takes `view`/`modify` permissions
 * rather than `execute`/`public_access`/`view`. The two disagree whenever a
 * skill has been edited but not republished, so they are never interchangeable.
 */
export type SkillView = "published" | "draft";

function skillPath(skillId: string, view: SkillView, path: string): string {
  const seg = view === "draft" ? "management/" : "";
  return `${BASE}/skills/${encodeURIComponent(skillId)}/${seg}${path}`;
}

/** Download a skill as a zip archive (raw bytes). */
export async function downloadSkill(
  ctx: RequestContext,
  skillId: string,
  view: SkillView = "published",
): Promise<Uint8Array> {
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx.insecure, `${ctx.baseUrl}${skillPath(skillId, view, "download")}`, {
      headers: buildHeaders(ctx),
    }),
  );
  if (!res.ok) throw new HttpError(res.status, res.statusText, await res.text());
  return new Uint8Array(await res.arrayBuffer());
}

export interface ExecuteSkillOptions {
  /** Shell command run inside the sandbox, relative to the skill's work dir. */
  entryShell: string;
  /** Sandbox wall-clock limit in seconds. */
  timeout?: number;
}

export interface SkillExecutionResult {
  skill_id?: string;
  session_id?: string;
  work_dir?: string;
  command?: string;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  execution_time?: number;
  /** True when the sandbox stubbed the run instead of executing it. */
  mocked?: boolean;
}

/**
 * Run a skill in the platform sandbox. The platform uploads the skill package
 * into a session and runs `entry_shell` from its work dir, so scripts address
 * bundled files by relative path.
 */
export function executeSkill(
  ctx: RequestContext,
  skillId: string,
  opts: ExecuteSkillOptions,
): Promise<SkillExecutionResult> {
  return request(ctx, `${BASE}/skills/${encodeURIComponent(skillId)}/execute`, {
    method: "POST",
    body: {
      entry_shell: opts.entryShell,
      ...(opts.timeout === undefined ? {} : { timeout: opts.timeout }),
    },
    // Outlast the sandbox: the default client timeout is shorter than the run
    // budget, so without this a long run aborts locally mid-execution and the
    // caller never learns the exit code. With no stated limit the sandbox
    // applies its own — 300s by default, 3600s at most — so the budget has to
    // cover that rather than a number of ours.
    timeoutMs: (opts.timeout ?? SANDBOX_MAX_TIMEOUT_SEC) * 1000 + 15_000,
  }) as Promise<SkillExecutionResult>;
}

/**
 * The sandbox's own ceiling, used as the client's abort budget when the caller
 * names no limit.
 *
 * Every hop passes `timeout` through untouched — `ExecuteSkill` to
 * `ExecuteShell` to the sandbox control plane's `execute-sync`, `omitempty`
 * throughout — so with the field absent the limit is the sandbox's: 300s by
 * default, 3600s as the documented maximum (`infra/sandbox/CLAUDE.md`). Budget
 * against the maximum, because a deploy may raise the default and a client that
 * gave up first would report an abort where an exit code was coming.
 *
 * Only ever a local budget: it is never sent, and it never shortens a run.
 */
export const SANDBOX_MAX_TIMEOUT_SEC = 3600;

/** Resolve skill ids to names in one call. Unknown ids are skipped by the backend. */
export function getSkillNames(ctx: RequestContext, ids: string[]): Promise<unknown> {
  return request(ctx, `${BASE}/skills/names`, { method: "POST", body: { ids } });
}

/** Update a skill's editable metadata (JSON PUT). */
export function updateSkillMetadata(
  ctx: RequestContext,
  skillId: string,
  body: unknown,
): Promise<unknown> {
  return request(ctx, `${BASE}/skills/${encodeURIComponent(skillId)}`, { method: "PUT", body });
}

/** Republish a previous skill version (`POST /skills/:id/history/republish`). */
export function republishSkillVersion(
  ctx: RequestContext,
  skillId: string,
  version: string,
): Promise<unknown> {
  return request(ctx, `${BASE}/skills/${encodeURIComponent(skillId)}/history/republish`, {
    method: "POST",
    body: { version },
  });
}

/** Publish a historical skill version (`POST /skills/:id/history/publish`). */
export function publishSkillVersion(
  ctx: RequestContext,
  skillId: string,
  version: string,
): Promise<unknown> {
  return request(ctx, `${BASE}/skills/${encodeURIComponent(skillId)}/history/publish`, {
    method: "POST",
    body: { version },
  });
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

/**
 * `url` hands back a pre-signed object-store link; `content` inlines the file
 * body. Only the management surface honours `content` today — the consumer
 * surface ignores it and answers with a URL either way.
 */
export type SkillResponseMode = "url" | "content";

export interface SkillContentResponse {
  skill_id?: string;
  version?: string;
  url?: string;
  /** Present only when the backend honoured `response_mode=content`. */
  content?: string;
  files?: SkillFileEntry[];
}

export interface SkillFileEntry {
  rel_path: string;
  file_type?: string;
  size?: number;
  mime_type?: string;
}

export interface SkillReadFileResponse {
  skill_id?: string;
  rel_path?: string;
  url?: string;
  content?: string;
  mime_type?: string;
  file_type?: string;
}

/** Read a skill's SKILL.md content index (and its file manifest). */
export function getSkillContent(
  ctx: RequestContext,
  skillId: string,
  opts: { view?: SkillView; responseMode?: SkillResponseMode } = {},
): Promise<SkillContentResponse> {
  return request(ctx, skillPath(skillId, opts.view ?? "published", "content"), {
    query: { response_mode: opts.responseMode },
  }) as Promise<SkillContentResponse>;
}

/** Read a file inside a skill (progressive). */
export function readSkillFile(
  ctx: RequestContext,
  skillId: string,
  relPath: string,
  opts: { view?: SkillView; responseMode?: SkillResponseMode } = {},
): Promise<SkillReadFileResponse> {
  return request(ctx, skillPath(skillId, opts.view ?? "published", "files/read"), {
    method: "POST",
    query: { response_mode: opts.responseMode },
    body: { rel_path: relPath },
  }) as Promise<SkillReadFileResponse>;
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
