/**
 * Toolbox + tool client (agent-operator-integration tool-box). Read side.
 * Passed through as parsed JSON.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { RequestContext } from "../types.js";
import { HttpError } from "../utils/errors.js";
import { authFetch } from "./auth-fetch.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { applyTls } from "./tls.js";

const PATH = "/api/agent-operator-integration/v1/tool-box";

const IMPEX = "/api/agent-operator-integration/v1/impex";
export type ImpexType = "toolbox" | "mcp" | "operator";

/** Export a toolbox/mcp/operator config as raw `.adp` bytes (GET impex/export). */
export async function exportConfig(
  ctx: RequestContext,
  id: string,
  type: ImpexType = "toolbox",
): Promise<Uint8Array> {
  applyTls(ctx);
  const res = await authFetch(ctx, () =>
    fetch(`${ctx.baseUrl}${IMPEX}/export/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, {
      headers: buildHeaders(ctx),
    }),
  );
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) throw new HttpError(res.status, res.statusText, new TextDecoder().decode(buf));
  return buf;
}

/** Import a previously exported `.adp` config file (POST impex/import, multipart `data`). */
export async function importConfig(
  ctx: RequestContext,
  filePath: string,
  type: ImpexType = "toolbox",
): Promise<unknown> {
  applyTls(ctx);
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("data", new Blob([new Uint8Array(buf)]), basename(filePath));
  const res = await authFetch(ctx, () =>
    fetch(`${ctx.baseUrl}${IMPEX}/import/${encodeURIComponent(type)}`, {
      method: "POST",
      headers: buildHeaders(ctx),
      body: form,
    }),
  );
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, res.statusText, text);
  return text ? JSON.parse(text) : text;
}

/**
 * Upload a tool definition file (e.g. an OpenAPI spec) into a toolbox.
 * `POST /tool-box/:id/tool` multipart: `metadata_type` + `data` (file).
 */
export async function uploadTool(
  ctx: RequestContext,
  boxId: string,
  filePath: string,
  metadataType = "openapi",
): Promise<unknown> {
  applyTls(ctx);
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("metadata_type", metadataType);
  form.append("data", new Blob([new Uint8Array(buf)]), basename(filePath));
  const res = await authFetch(ctx, () =>
    fetch(`${ctx.baseUrl}${PATH}/${encodeURIComponent(boxId)}/tool`, {
      method: "POST",
      headers: buildHeaders(ctx),
      body: form,
    }),
  );
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, res.statusText, text);
  return text ? JSON.parse(text) : text;
}

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

export interface ToolInvokeEnvelope {
  header?: Record<string, unknown>;
  query?: Record<string, unknown>;
  path?: Record<string, unknown>;
  body?: unknown;
  timeout?: number;
}

function envelope(e: ToolInvokeEnvelope): Record<string, unknown> {
  return {
    ...(e.timeout !== undefined ? { timeout: e.timeout } : {}),
    header: e.header ?? {},
    query: e.query ?? {},
    path: e.path ?? {},
    body: e.body ?? {},
  };
}

/** Execute a published+enabled tool through the toolbox proxy. */
export function executeTool(
  ctx: RequestContext,
  boxId: string,
  toolId: string,
  e: ToolInvokeEnvelope = {},
): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/proxy/${encodeURIComponent(toolId)}`, {
    method: "POST",
    body: envelope(e),
  });
}

/** Debug a tool (works on draft/disabled tools too). */
export function debugTool(
  ctx: RequestContext,
  boxId: string,
  toolId: string,
  e: ToolInvokeEnvelope = {},
): Promise<unknown> {
  return request(
    ctx,
    `${PATH}/${encodeURIComponent(boxId)}/tool/${encodeURIComponent(toolId)}/debug`,
    {
      method: "POST",
      body: envelope(e),
    },
  );
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
