// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Context-loader client over the agent-retrieval MCP endpoint (JSON-RPC).
 * Slim implementation: initialize → session id →
 * notifications/initialized, then tools/call. Handles plain-JSON and
 * SSE (`data:`) response bodies. Per-process session cache (5 min TTL).
 */
import { createOperationTraceContext } from "../trace-context.js";
import type { RequestContext } from "../types.js";
import { HttpError } from "../utils/errors.js";
import { authFetch } from "./auth-fetch.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { tlsFetch } from "./tls.js";
import type { OperationReceipt } from "./trace-lifecycle.js";

const MCP_PATH = "/api/agent-retrieval/v1/mcp";
const PROTOCOL = "2024-11-05";
const SESSION_TTL_MS = 300_000;

const sessions = new Map<string, { id: string; at: number }>();
let rpcId = 0;
function nextId(): number {
  rpcId += 1;
  return rpcId;
}

function mcpUrl(ctx: RequestContext): string {
  return `${ctx.baseUrl}${MCP_PATH}`;
}

function operationContext(ctx: RequestContext): RequestContext {
  return ctx.trace ? { ...ctx, trace: createOperationTraceContext(ctx.trace) } : ctx;
}

/**
 * The deploy's MCP tool catalog (`GET .../mcp/info`) — global, no KN needed.
 * Use this to discover what tools exist before binding to a specific KN; the
 * per-KN `tools/list` (see {@link listTools}) returns the same catalog scoped
 * to a session.
 */
export function mcpInfo(ctx: RequestContext): Promise<unknown> {
  return request(ctx, `${MCP_PATH}/info`);
}

function headers(ctx: RequestContext, knId: string, sessionId?: string): Record<string, string> {
  return buildHeaders(ctx, {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-kn-id": knId,
    "mcp-protocol-version": PROTOCOL,
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
  });
}

/** Parse a JSON-RPC response body that may be plain JSON or an SSE stream. */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const data = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (data) return JSON.parse(data);
    throw new Error(`Context-loader returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

async function post(
  ctx: RequestContext,
  knId: string,
  sessionId: string | undefined,
  body: unknown,
) {
  const res = await authFetch(ctx, () =>
    tlsFetch(ctx.insecure, mcpUrl(ctx), {
      method: "POST",
      headers: headers(ctx, knId, sessionId),
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, res.statusText, text);
  return { res, text };
}

async function ensureSession(ctx: RequestContext, knId: string): Promise<string> {
  const key = `${mcpUrl(ctx)}:${knId}`;
  const cached = sessions.get(key);
  if (cached && Date.now() - cached.at < SESSION_TTL_MS) return cached.id;
  sessions.delete(key);

  const { res } = await post(ctx, knId, undefined, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "openbkn", version: "0.1.0" },
    },
  });
  const sessionId = res.headers.get("mcp-session-id") ?? res.headers.get("MCP-Session-Id");
  if (!sessionId) throw new Error("MCP server did not return a session id.");

  await post(ctx, knId, sessionId, { jsonrpc: "2.0", method: "notifications/initialized" });
  sessions.set(key, { id: sessionId, at: Date.now() });
  return sessionId;
}

export interface ManagedToolResult<T = unknown> {
  value: T;
  receipt: OperationReceipt;
}

/** Adapter-owned MCP metadata for lifecycle-safe host retries. */
export interface ToolCallOptions {
  hostConversationKey?: string;
  clientInvocationId?: string;
}

interface UnwrappedToolResult {
  value: unknown;
  receipt?: OperationReceipt;
}

/** Unwrap a JSON-RPC result without discarding its trusted lifecycle receipt. */
function unwrapToolResult(parsed: unknown): UnwrappedToolResult {
  const rpc = parsed as { result?: unknown; error?: { message: string } };
  if (rpc.error) throw new Error(`Context-loader error: ${rpc.error.message}`);
  const result = rpc.result as Record<string, unknown> | undefined;
  if (result === undefined) return { value: parsed };
  const structuredContent = result.structuredContent;
  const receipt = (structuredContent as { bkn_receipt?: OperationReceipt } | undefined)
    ?.bkn_receipt;
  const content = result.content;
  if (result.isError === true) {
    const message =
      Array.isArray(content) && content[0] && typeof content[0].text === "string"
        ? content[0].text
        : "tool call failed";
    throw new Error(`Context-loader error: ${message}`);
  }
  if (Array.isArray(content) && content[0] && typeof content[0].text === "string") {
    try {
      return { value: JSON.parse(content[0].text), receipt };
    } catch {
      if (structuredContent !== undefined) {
        return { value: structuredContent, receipt };
      }
      return { value: { raw: content[0].text }, receipt };
    }
  }
  return { value: result, receipt };
}

function toolCallParams(
  name: string,
  args: Record<string, unknown>,
  options?: ToolCallOptions,
): Record<string, unknown> {
  const meta = {
    ...(options?.hostConversationKey
      ? { "openbkn.ai/host-conversation-key": options.hostConversationKey }
      : {}),
    ...(options?.clientInvocationId
      ? { "openbkn.ai/client-invocation-id": options.clientInvocationId }
      : {}),
  };
  return {
    name,
    arguments: args,
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}

/** Call any MCP tool by name. */
export async function callTool(
  ctx: RequestContext,
  knId: string,
  name: string,
  args: Record<string, unknown>,
  options?: ToolCallOptions,
): Promise<unknown> {
  const operationCtx = operationContext(ctx);
  const sessionId = await ensureSession(operationCtx, knId);
  const { text } = await post(operationCtx, knId, sessionId, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: toolCallParams(name, args, options),
    id: nextId(),
  });
  return unwrapToolResult(parseBody(text)).value;
}

/** Call a lifecycle-managed MCP tool and retain the trusted operation receipt. */
export async function callManagedTool<T = unknown>(
  ctx: RequestContext,
  knId: string,
  name: string,
  args: Record<string, unknown>,
  options?: ToolCallOptions,
): Promise<ManagedToolResult<T>> {
  const operationCtx = operationContext(ctx);
  const sessionId = await ensureSession(operationCtx, knId);
  const { text } = await post(operationCtx, knId, sessionId, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: toolCallParams(name, args, options),
    id: nextId(),
  });
  const result = unwrapToolResult(parseBody(text));
  if (!result.receipt) {
    throw new Error("Context-loader managed tool response did not include bkn_receipt");
  }
  return { value: result.value as T, receipt: result.receipt };
}

/** Call a generic MCP method (tools/list, resources/list, ...). */
export async function callMethod(
  ctx: RequestContext,
  knId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const operationCtx = operationContext(ctx);
  const sessionId = await ensureSession(operationCtx, knId);
  const { text } = await post(operationCtx, knId, sessionId, {
    jsonrpc: "2.0",
    method,
    params: Object.keys(params).length > 0 ? params : undefined,
    id: nextId(),
  });
  const parsed = parseBody(text) as { result?: unknown; error?: { message: string } };
  if (parsed.error) throw new Error(`Context-loader error: ${parsed.error.message}`);
  return parsed.result;
}

// ---- typed tool wrappers ---------------------------------------------------

export interface SearchSchemaOptions {
  searchScope?: string[];
  maxConcepts?: number;
}

export function searchSchema(
  ctx: RequestContext,
  knId: string,
  query: string,
  opts: SearchSchemaOptions = {},
): Promise<unknown> {
  const args: Record<string, unknown> = { query, response_format: "json" };
  if (opts.searchScope) args.search_scope = opts.searchScope;
  if (opts.maxConcepts !== undefined) args.max_concepts = opts.maxConcepts;
  return callTool(ctx, knId, "search_schema", args);
}

export function queryObjectInstance(
  ctx: RequestContext,
  knId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return callTool(ctx, knId, "query_object_instance", args);
}

export function findSkills(
  ctx: RequestContext,
  knId: string,
  objectTypeId: string,
  topK?: number,
): Promise<unknown> {
  const args: Record<string, unknown> = { object_type_id: objectTypeId };
  if (topK !== undefined) args.top_k = topK;
  return callTool(ctx, knId, "find_skills", args);
}

/** Progressive KN-detail disclosure level: `summary` (skeleton + property names) | `full`. */
export type DetailLevel = "summary" | "full";

/**
 * get_kn_detail — the KN schema at a chosen detail level. `summary` (the server
 * default) returns the skeleton + per-property `name/display_name/type/comment`
 * only; `full` returns everything (still deduped). Drill into specific types with
 * `getObjectTypes` / `getRelationTypes`.
 */
export function getKnDetail(
  ctx: RequestContext,
  knId: string,
  detailLevel?: DetailLevel,
): Promise<unknown> {
  const args: Record<string, unknown> = { response_format: "json" };
  if (detailLevel) args.detail_level = detailLevel;
  return callTool(ctx, knId, "get_kn_detail", args);
}

/**
 * get_object_types — full definitions for the given object-type ids. Ids with no
 * match come back under the response's `missing` array. `ids` is sent as a JSON
 * array (the server rejects a comma-joined string).
 */
export function getObjectTypes(ctx: RequestContext, knId: string, ids: string[]): Promise<unknown> {
  return callTool(ctx, knId, "get_object_types", { ids, response_format: "json" });
}

/** get_relation_types — full definitions for the given relation-type ids; unmatched under `missing`. */
export function getRelationTypes(
  ctx: RequestContext,
  knId: string,
  ids: string[],
): Promise<unknown> {
  return callTool(ctx, knId, "get_relation_types", { ids, response_format: "json" });
}

export function listTools(ctx: RequestContext, knId: string): Promise<unknown> {
  return callMethod(ctx, knId, "tools/list");
}

/** Layer-2 subgraph query across relation-type paths (`query_instance_subgraph`). */
export function queryInstanceSubgraph(
  ctx: RequestContext,
  knId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return callTool(ctx, knId, "query_instance_subgraph", args);
}

/** Layer-3 logic-property values for given instances (`get_logic_properties_values`). */
export function getLogicProperties(
  ctx: RequestContext,
  knId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return callTool(ctx, knId, "get_logic_properties_values", args);
}

/** Layer-3 action info / dynamic tools for an instance (`get_action_info`). */
export function getActionInfo(
  ctx: RequestContext,
  knId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return callTool(ctx, knId, "get_action_info", args);
}

// ---- standard MCP resource / prompt methods --------------------------------

export function listResources(ctx: RequestContext, knId: string): Promise<unknown> {
  return callMethod(ctx, knId, "resources/list");
}
export function readResource(ctx: RequestContext, knId: string, uri: string): Promise<unknown> {
  return callMethod(ctx, knId, "resources/read", { uri });
}
export function listResourceTemplates(ctx: RequestContext, knId: string): Promise<unknown> {
  return callMethod(ctx, knId, "resources/templates/list");
}
export function listPrompts(ctx: RequestContext, knId: string): Promise<unknown> {
  return callMethod(ctx, knId, "prompts/list");
}
export function getPrompt(
  ctx: RequestContext,
  knId: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return callMethod(ctx, knId, "prompts/get", { name, arguments: args });
}
