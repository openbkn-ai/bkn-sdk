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
import { type FunctionDefinition, functionInputBody, functionInputEditBody } from "./functions.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { sandboxBudgetMs } from "./sandbox-budget.js";
import { tlsFetch } from "./tls.js";
import { ensureCompatible } from "./version-check.js";

const PATH = "/api/agent-operator-integration/v1/tool-box";

const IMPEX = "/api/agent-operator-integration/v1/impex";
/** The impex component types (`ComponentType`); any other value is a 400. */
export const IMPEX_TYPES = ["toolbox", "mcp", "operator"] as const;
export type ImpexType = (typeof IMPEX_TYPES)[number];
/**
 * What an import does with a component that already exists: `create` refuses
 * it (409 `CommonResourceIDConflict` on a live deploy; the contract still says
 * 400), `upsert` updates it. The service defaults to `create`.
 */
export type ImpexMode = "create" | "upsert";

/** Export a toolbox/mcp/operator config as raw `.adp` bytes (GET impex/export). */
export async function exportConfig(
  ctx: RequestContext,
  id: string,
  type: ImpexType = "toolbox",
): Promise<Uint8Array> {
  await ensureCompatible(
    ctx,
    new URL(`${ctx.baseUrl}${IMPEX}/export/${encodeURIComponent(type)}/${encodeURIComponent(id)}`),
  );
  const res = await authFetch(ctx, () =>
    tlsFetch(
      ctx,
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

/**
 * Import a previously exported `.adp` config file (POST impex/import, multipart
 * `data`). `mode` is sent only when given, so the service's own default
 * (`create`) applies otherwise.
 */
export async function importConfig(
  ctx: RequestContext,
  filePath: string,
  type: ImpexType = "toolbox",
  opts: { mode?: ImpexMode } = {},
): Promise<unknown> {
  const buf = await readFile(filePath);
  await ensureCompatible(ctx, new URL(`${ctx.baseUrl}${IMPEX}/import/${encodeURIComponent(type)}`));
  const form = new FormData();
  form.append("data", new Blob([new Uint8Array(buf)]), basename(filePath));
  if (opts.mode) form.append("mode", opts.mode);
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx, `${ctx.baseUrl}${IMPEX}/import/${encodeURIComponent(type)}`, {
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
 * also describe a function. The contract documents only the JSON encoding for
 * this endpoint; the multipart form is what the service's own UI posts.
 */
export async function uploadTool(
  ctx: RequestContext,
  boxId: string,
  filePath: string,
  metadataType: ToolMetadataType = "openapi",
): Promise<unknown> {
  const buf = await readFile(filePath);
  await ensureCompatible(ctx, new URL(`${ctx.baseUrl}${PATH}/${encodeURIComponent(boxId)}/tool`));
  const form = new FormData();
  form.append("metadata_type", metadataType);
  form.append("data", new Blob([new Uint8Array(buf)]), basename(filePath));
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx, `${ctx.baseUrl}${PATH}/${encodeURIComponent(boxId)}/tool`, {
      method: "POST",
      headers: buildHeaders(ctx),
      body: form,
    }),
  );
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, res.statusText, text);
  return text ? parseBigIntJSON(text) : text;
}

/** `MetadataType`: what a tool (or a box's tools) is described by. */
export const TOOL_METADATA_TYPES = ["openapi", "function"] as const;
export type ToolMetadataType = (typeof TOOL_METADATA_TYPES)[number];

/**
 * A parameter fixed onto every call of a tool (a shared API key, say). The
 * service takes a **single object**, not an array.
 */
export interface GlobalParameter {
  name: string;
  description: string;
  in: "query" | "path" | "header" | "cookie" | "body";
  type: "string" | "integer" | "boolean" | "array" | "object";
  required?: boolean;
  value?: unknown;
}

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
  /** A single global parameter attached to every call of the tool. */
  globalParameters?: GlobalParameter;
  extendInfo?: Record<string, unknown>;
}

function toolBody(opts: CreateToolOptions, edit = false): Record<string, unknown> {
  return {
    metadata_type: opts.metadataType,
    ...(opts.function
      ? {
          function_input: edit
            ? functionInputEditBody(opts.function)
            : functionInputBody(opts.function),
        }
      : {}),
    ...(opts.data !== undefined ? { data: opts.data } : {}),
    ...(opts.useRule ? { use_rule: opts.useRule } : {}),
    ...(opts.globalParameters ? { global_parameters: opts.globalParameters } : {}),
    ...(opts.extendInfo ? { extend_info: opts.extendInfo } : {}),
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
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/tool/${encodeURIComponent(toolId)}`, {
    // `*_time` fields are nanoseconds — past 2^53, so a plain parse rounds them.
    responseParser: parseBigIntJSON,
  });
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
 * `function_input` goes in its edit form (`FunctionInputEdit`): `name` and
 * `description` travel at the top level only. `function.name` is ignored here.
 */
export function updateTool(
  ctx: RequestContext,
  boxId: string,
  toolId: string,
  opts: UpdateToolOptions,
): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/tool/${encodeURIComponent(toolId)}`, {
    method: "POST",
    body: { name: opts.name, description: opts.description, ...toolBody(opts, true) },
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

/** A toolbox's lifecycle. Separate from a tool's own `enabled` / `disabled`. */
export type ToolboxStatus = "unpublish" | "published" | "offline";

export type SortOrder = "asc" | "desc";

/**
 * One entry of `GET /tool-box/list` (`ToolBoxInfo`). Only the fields the SDK
 * documents are typed; the rest pass through.
 */
export interface ToolBoxInfo {
  /**
   * The caller's effective operations on this box, projected only on the
   * management list. The service omits it when empty, so treat absent as `[]`.
   */
  operations?: Array<"view" | "modify" | "publish" | "unpublish" | "delete" | "authorize">;
  box_id?: string;
  box_name?: string;
  box_desc?: string;
  box_svc_url?: string;
  metadata_type?: ToolMetadataType;
  status?: string;
  category_type?: string;
  category_name?: string;
  is_internal?: boolean;
  source?: string;
  /** Tool **names**, not objects or ids. */
  tools?: string[];
  [key: string]: unknown;
}

/** A page size the service accepts, or nothing — never `NaN` or `0` on the wire. */
function pageSizeOf(n: number | undefined): number | undefined {
  return Number.isFinite(n) && n! > 0 ? n : undefined;
}

export interface ListToolboxesOptions {
  /** Filter by toolbox name. */
  name?: string;
  /** @deprecated The service never read `keyword`; sent as `name`. */
  keyword?: string;
  /** 1-based. */
  page?: number;
  /** 1–100; the service defaults to 10. */
  pageSize?: number;
  /** @deprecated Use `pageSize`. */
  limit?: number;
  sortBy?: "create_time" | "update_time" | "name";
  sortOrder?: SortOrder;
  status?: ToolboxStatus;
  category?: string;
  createUser?: string;
  releaseUser?: string;
  metadataType?: ToolMetadataType;
  /** Ignore paging and return every toolbox. */
  all?: boolean;
}

/**
 * Toolboxes the caller can `view`. The service pages by `page` / `page_size` —
 * it has no `offset`, and a `limit` or `keyword` is silently ignored, which is
 * how a filter that "worked" used to return the first ten boxes unfiltered.
 */
export function listToolboxes(
  ctx: RequestContext,
  opts: ListToolboxesOptions = {},
): Promise<unknown> {
  return request(ctx, `${PATH}/list`, {
    query: {
      page: opts.page,
      page_size: pageSizeOf(opts.pageSize ?? opts.limit),
      sort_by: opts.sortBy,
      sort_order: opts.sortOrder,
      name: opts.name || opts.keyword || undefined,
      status: opts.status,
      category: opts.category || undefined,
      create_user: opts.createUser || undefined,
      release_user: opts.releaseUser || undefined,
      metadata_type: opts.metadataType,
      all: opts.all ? "true" : undefined,
    },
    responseParser: parseBigIntJSON,
  });
}

export interface ListToolsOptions {
  page?: number;
  pageSize?: number;
  all?: boolean;
  /** Filter by tool name. */
  name?: string;
  status?: "enabled" | "disabled";
  /** The service defaults to `create_time` here (the toolbox list defaults to `update_time`). */
  sortBy?: "create_time" | "update_time" | "tool_name";
  sortOrder?: SortOrder;
  /** Filter by creator. */
  userId?: string;
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
      page_size: pageSizeOf(opts.pageSize),
      all: opts.all ? "true" : undefined,
      name: opts.name || undefined,
      status: opts.status,
      sort_by: opts.sortBy,
      sort_order: opts.sortOrder,
      user_id: opts.userId || undefined,
    },
    responseParser: parseBigIntJSON,
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
  /** `box_category`; the service files the box under `other_category` when omitted. */
  category?: string;
  /**
   * An OpenAPI document to import as the box's tools at creation. Sent as
   * given: the contract declares a string, while the tool-create endpoint
   * wants the parsed document, so pass whichever your deploy accepts.
   */
  data?: unknown;
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
      ...(opts.category ? { box_category: opts.category } : {}),
      ...(opts.data !== undefined ? { data: opts.data } : {}),
    },
  });
}

export function deleteToolbox(ctx: RequestContext, boxId: string): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}`, { method: "DELETE" });
}

/**
 * Move a toolbox through its lifecycle: `published` publishes it, `offline`
 * takes it down. There is no `draft` — the service knows only
 * `unpublish` / `published` / `offline`, and `unpublish` is the state a box is
 * born in rather than the one it is taken down to.
 */
export function setToolboxStatus(
  ctx: RequestContext,
  boxId: string,
  status: ToolboxStatus,
): Promise<unknown> {
  return request(ctx, `${PATH}/${encodeURIComponent(boxId)}/status`, {
    method: "POST",
    body: { status },
  });
}

export interface ToolInvokeEnvelope {
  header?: Record<string, unknown>;
  query?: Record<string, unknown>;
  /** Path parameters; the contract types every value as a string. */
  path?: Record<string, string>;
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

/**
 * Transport for one tool call. A function tool runs in the sandbox and the
 * proxy sends nothing until it is over, so `timeout` has to move the client's
 * abort budget and undici's header deadline too — otherwise the client's 30s
 * default gives up on a call the service was told it may take longer over.
 * The upstream body is passed through, so integers are parsed losslessly.
 */
function invokeInit(e: ToolInvokeEnvelope) {
  return {
    method: "POST",
    body: envelope(e),
    timeoutMs: sandboxBudgetMs(e.timeout),
    headersTimeoutMs: sandboxBudgetMs(e.timeout),
    responseParser: parseBigIntJSON,
  } as const;
}

/** Execute a published+enabled tool through the toolbox proxy. */
export function executeTool(
  ctx: RequestContext,
  boxId: string,
  toolId: string,
  e: ToolInvokeEnvelope = {},
): Promise<unknown> {
  return request(
    ctx,
    `${PATH}/${encodeURIComponent(boxId)}/proxy/${encodeURIComponent(toolId)}`,
    invokeInit(e),
  );
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
    invokeInit(e),
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
