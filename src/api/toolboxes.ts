// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Toolbox + tool client (agent-operator-integration tool-box). Read side.
 * Passed through as parsed JSON.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { RequestContext } from "../types.js";
import { HttpError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { authFetch } from "./auth-fetch.js";
import { type FunctionDefinition, functionInputBody } from "./functions.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { tlsFetch } from "./tls.js";

const PATH = "/api/agent-operator-integration/v1/tool-box";

const IMPEX = "/api/agent-operator-integration/v1/impex";
export type ImpexType = "toolbox" | "mcp" | "operator";

/** Export a toolbox/mcp/operator config as raw `.adp` bytes (GET impex/export). */
export async function exportConfig(
  ctx: RequestContext,
  id: string,
  type: ImpexType = "toolbox",
): Promise<Uint8Array> {
  const res = await authFetch(ctx, () =>
    tlsFetch(
      ctx.insecure,
      `${ctx.baseUrl}${IMPEX}/export/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      {
        headers: buildHeaders(ctx),
      },
    ),
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
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("data", new Blob([new Uint8Array(buf)]), basename(filePath));
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx.insecure, `${ctx.baseUrl}${IMPEX}/import/${encodeURIComponent(type)}`, {
      method: "POST",
      headers: buildHeaders(ctx),
      body: form,
    }),
  );
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, res.statusText, text);
  return text ? parseBigIntJSON(text) : text;
}

/**
 * Upload a tool definition file (e.g. an OpenAPI spec) into a toolbox.
 * `POST /tool-box/:id/tool` multipart: `metadata_type` + `data` (file).
 *
 * The same endpoint as {@link createTool}, in its other encoding: this one
 * streams the file, that one carries the definition as JSON and can therefore
 * also describe a function.
 */
export async function uploadTool(
  ctx: RequestContext,
  boxId: string,
  filePath: string,
  metadataType = "openapi",
): Promise<unknown> {
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("metadata_type", metadataType);
  form.append("data", new Blob([new Uint8Array(buf)]), basename(filePath));
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx.insecure, `${ctx.baseUrl}${PATH}/${encodeURIComponent(boxId)}/tool`, {
      method: "POST",
      headers: buildHeaders(ctx),
      body: form,
    }),
  );
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, res.statusText, text);
  return text ? parseBigIntJSON(text) : text;
}

export type ToolMetadataType = "openapi" | "function";

export interface CreateToolOptions {
  metadataType: ToolMetadataType;
  /** Required for `function`. */
  function?: FunctionDefinition;
  /**
   * Required for `openapi`: the specification as a **parsed document**, not as
   * text. This endpoint unmarshals `data` straight into an OpenAPI type, so a
   * string is a 400 here — while `/operator/register` takes the same field as
   * a string. Verified against a live deploy, in both directions.
   */
  data?: unknown;
  useRule?: string;
}

function toolBody(opts: CreateToolOptions): Record<string, unknown> {
  return {
    metadata_type: opts.metadataType,
    ...(opts.function ? { function_input: functionInputBody(opts.function) } : {}),
    ...(opts.data !== undefined ? { data: opts.data } : {}),
    ...(opts.useRule ? { use_rule: opts.useRule } : {}),
  };
}

/**
 * Create tools in a box from JSON — the only way to add a `function` tool, and
 * the same endpoint `uploadTool` posts a spec file to. One OpenAPI document
 * makes as many tools as it has operations, so the answer is a batch result:
 * `failure_count` can be non-zero on an HTTP 200.
 */
export function createTool(
  ctx: RequestContext,
  boxId: string,
  opts: CreateToolOptions,
): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/tool`, {
    method: "POST",
    body: toolBody(opts),
  });
}

/** One tool in full: metadata, global parameters, usage rule. */
export function getTool(ctx: RequestContext, boxId: string, toolId: string): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/tool/${encodeURIComponent(toolId)}`);
}

export interface UpdateToolOptions extends CreateToolOptions {
  /** Required by the service even when unchanged — this replaces, not patches. */
  name: string;
  description: string;
}

/**
 * Replace a tool's definition. POST, not PUT, and the id survives: a new
 * metadata version is generated behind the same `tool_id`, so nothing that
 * points at the tool has to be rebound and an enabled tool stays enabled.
 */
export function updateTool(
  ctx: RequestContext,
  boxId: string,
  toolId: string,
  opts: UpdateToolOptions,
): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/tool/${encodeURIComponent(toolId)}`, {
    method: "POST",
    body: { name: opts.name, description: opts.description, ...toolBody(opts) },
  });
}

/** Delete tools from a box. */
export function deleteTools(
  ctx: RequestContext,
  boxId: string,
  toolIds: string[],
): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/tools/batch-delete`, {
    method: "POST",
    body: { tool_ids: toolIds },
  });
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

export interface ListToolsOptions {
  page?: number;
  pageSize?: number;
  all?: boolean;
}

/** List tools inside a toolbox. Backend defaults to page_size=10 (max 100); pass
 *  `all: true` to return every tool regardless of page size. */
export function listTools(
  ctx: RequestContext,
  boxId: string,
  opts: ListToolsOptions = {},
): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/tools/list`, {
    query: {
      page: opts.page,
      page_size: Number.isFinite(opts.pageSize) && opts.pageSize! > 0 ? opts.pageSize : undefined,
      all: opts.all ? "true" : undefined,
    },
  });
}

export interface CreateToolboxOptions {
  name: string;
  /** Required for an `openapi` box: where its tools are proxied to. */
  serviceUrl?: string;
  description?: string;
  source?: string;
  /**
   * `openapi` proxies each tool to `serviceUrl`; `function` holds tools that
   * run as platform functions and takes no service URL.
   */
  metadataType?: "openapi" | "function";
}

export function createToolbox(ctx: RequestContext, opts: CreateToolboxOptions): Promise<unknown> {
  return request(ctx, PATH, {
    method: "POST",
    body: {
      metadata_type: opts.metadataType ?? "openapi",
      box_name: opts.name,
      box_desc: opts.description ?? "",
      ...(opts.serviceUrl ? { box_svc_url: opts.serviceUrl } : {}),
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
