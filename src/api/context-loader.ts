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
import { withoutPreview } from "../utils/dry-run.js";
import { HttpError, ToolError, readableServerError } from "../utils/errors.js";
import { parseBigIntJSON, stringifyBigIntJSON } from "../utils/json-bigint.js";
import { authFetch } from "./auth-fetch.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import { withManagedLifecycle } from "./lifecycle.js";
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
    return parseBigIntJSON(text);
  } catch {
    const data = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (data) return parseBigIntJSON(data);
    throw new Error(`Context-loader returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

async function post(
  ctx: RequestContext,
  knId: string,
  sessionId: string | undefined,
  body: unknown,
  timeoutMs?: number,
) {
  // Unbounded by default: a tool call can legitimately run long, and this
  // transport has never imposed a deadline. Callers that run somewhere a hang
  // would strand the process — a release on the way out — pass one in.
  const controller = timeoutMs === undefined ? undefined : new AbortController();
  const timer =
    controller === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);
  // `tlsFetch` previews every outbound request, which would stop on the
  // handshake — the frames a caller checking their arguments did not ask about.
  const rpcMethod = (body as { method?: string } | undefined)?.method;
  const isHandshake =
    rpcMethod === "initialize" || Boolean(rpcMethod?.startsWith("notifications/"));
  const send = () =>
    authFetch(ctx, () =>
      tlsFetch(ctx.insecure, mcpUrl(ctx), {
        method: "POST",
        headers: headers(ctx, knId, sessionId),
        body: stringifyBigIntJSON(body),
        ...(controller ? { signal: controller.signal } : {}),
      }),
    );
  try {
    const res = await (isHandshake ? withoutPreview(send) : send());
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, res.statusText, text);
    return { res, text };
  } finally {
    if (timer) clearTimeout(timer);
  }
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

function isOperationReceipt(value: unknown): value is OperationReceipt {
  const receipt = value as Record<string, unknown> | undefined;
  return (
    typeof receipt?.receipt_id === "string" &&
    receipt.receipt_id.length > 0 &&
    typeof receipt.conversation_id === "string" &&
    receipt.conversation_id.length > 0 &&
    typeof receipt.interaction_id === "string" &&
    receipt.interaction_id.length > 0 &&
    typeof receipt.operation_id === "string" &&
    receipt.operation_id.length > 0 &&
    (receipt.receipt_status === "pending" ||
      receipt.receipt_status === "completed" ||
      receipt.receipt_status === "failed")
  );
}

function receiptFrom(structuredContent: unknown): OperationReceipt | undefined {
  const content = structuredContent as { bkn_receipt?: unknown; receipt?: unknown } | undefined;
  const candidate = content?.bkn_receipt ?? content?.receipt;
  if (candidate === undefined) return undefined;
  if (!isOperationReceipt(candidate)) {
    throw new Error("Context-loader returned an invalid operation receipt.");
  }
  return candidate;
}

function toolErrorCode(structuredContent: unknown): string | undefined {
  const code = (structuredContent as { error?: { code?: unknown } } | undefined)?.error?.code;
  return typeof code === "string" ? code : undefined;
}

/** Unwrap a JSON-RPC result without discarding its trusted lifecycle receipt. */
function unwrapToolResult(parsed: unknown): UnwrappedToolResult {
  const rpc = parsed as { result?: unknown; error?: { message: string; code?: unknown } };
  // A JSON-RPC top-level error is the server refusing this call — the same kind
  // of answer as an `isError` result, just delivered a layer lower by a gateway
  // that validates before dispatch. Raising it as a `ToolError` keeps that
  // distinguishable from the plain `Error`s here, which all mean the deploy was
  // never reached properly (bad JSON, no session id).
  if (rpc.error) {
    throw new ToolError(
      `Context-loader error: ${rpc.error.message}`,
      typeof rpc.error.code === "string" ? rpc.error.code : undefined,
    );
  }
  const result = rpc.result as Record<string, unknown> | undefined;
  if (result === undefined) return { value: parsed };
  const structuredContent = result.structuredContent;
  const receipt = receiptFrom(structuredContent);
  const content = result.content;
  if (result.isError === true) {
    const raw =
      Array.isArray(content) && content[0] && typeof content[0].text === "string"
        ? content[0].text
        : "tool call failed";
    // The tool hands back the platform envelope as a JSON string; a caller wants
    // the sentence inside it, not the envelope.
    const message = readableServerError(raw) || raw;
    // The structured error code, not the prose, is what tells a caller whether
    // the failure is retryable — a dead lifecycle session is reopenable, a bad
    // argument is not.
    throw new ToolError(`Context-loader error: ${message}`, toolErrorCode(structuredContent));
  }
  if (Array.isArray(content) && content[0] && typeof content[0].text === "string") {
    try {
      return { value: parseBigIntJSON(content[0].text), receipt };
    } catch {
      if (structuredContent !== undefined) {
        return { value: structuredContent, receipt };
      }
      return { value: { raw: content[0].text }, receipt };
    }
  }
  return { value: receipt ? null : result, receipt };
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

/**
 * Call an MCP tool exactly as given, with no lifecycle context attached.
 *
 * This is what the lifecycle module itself calls: the tools that open a session
 * cannot be wrapped in one without recurring.
 */
async function callToolRawResult(
  ctx: RequestContext,
  knId: string,
  name: string,
  args: Record<string, unknown>,
  options?: ToolCallOptions,
  timeoutMs?: number,
): Promise<UnwrappedToolResult> {
  const operationCtx = operationContext(ctx);
  const sessionId = await ensureSession(operationCtx, knId);
  const { text } = await post(
    operationCtx,
    knId,
    sessionId,
    {
      jsonrpc: "2.0",
      method: "tools/call",
      params: toolCallParams(name, args, options),
      id: nextId(),
    },
    timeoutMs,
  );
  return unwrapToolResult(parseBody(text));
}

export async function callToolRaw(
  ctx: RequestContext,
  knId: string,
  name: string,
  args: Record<string, unknown>,
  options?: ToolCallOptions,
  timeoutMs?: number,
): Promise<unknown> {
  return (await callToolRawResult(ctx, knId, name, args, options, timeoutMs)).value;
}

/**
 * The tools that manage lifecycle state rather than consume it. They are how a
 * session gets opened in the first place, so wrapping them in one would recur.
 */
const LIFECYCLE_TOOLS = new Set([
  "bkn_create_conversation",
  "bkn_resume_conversation",
  "bkn_start_interaction",
  "bkn_complete_interaction",
  "bkn_finish_interaction",
  "bkn_fail_interaction",
  "bkn_cancel_interaction",
  "bkn_handoff_interaction",
  "bkn_close_conversation",
  "bkn_get_operation",
  "bkn_retry_operation",
  "bkn_get_receipt",
]);

/**
 * Call any MCP tool by name.
 *
 * Deploys that enforce the lifecycle contract require a `bkn_context` in the
 * tool arguments, the same way they require one in an HTTP `/kn/*` body. Older
 * deploys merged a conversation per MCP connection and need nothing; the
 * capability probe decides which is which.
 */
async function callToolResult(
  ctx: RequestContext,
  knId: string,
  name: string,
  args: Record<string, unknown>,
  options?: ToolCallOptions,
): Promise<UnwrappedToolResult> {
  if (LIFECYCLE_TOOLS.has(name)) return callToolRawResult(ctx, knId, name, args, options);
  // A caller that built its own `bkn_context` gets it through untouched, and no
  // session is opened on its behalf. `ManagedTrace.runOperation` pre-registers
  // an Operation under a specific `operation_key` before handing the context to
  // the tool call; replacing that key would orphan the registration, and
  // `parent_operation_id` / `causation_event_ids` would be dropped with it.
  if (args.bkn_context !== undefined) return callToolRawResult(ctx, knId, name, args, options);
  return withManagedLifecycle(ctx, knId, questionFor(name, args), (bknContext) =>
    callToolRawResult(
      ctx,
      knId,
      name,
      bknContext ? { ...args, bkn_context: bknContext } : args,
      options,
    ),
  );
}

export async function callTool(
  ctx: RequestContext,
  knId: string,
  name: string,
  args: Record<string, unknown>,
  options?: ToolCallOptions,
): Promise<unknown> {
  return (await callToolResult(ctx, knId, name, args, options)).value;
}

/** The interaction's recorded question: the user's own words when the tool has them. */
function questionFor(name: string, args: Record<string, unknown>): string {
  return typeof args.query === "string" && args.query ? args.query : name;
}

/** Call a lifecycle-managed MCP tool and retain the trusted operation receipt. */
export async function callManagedTool<T = unknown>(
  ctx: RequestContext,
  knId: string,
  name: string,
  args: Record<string, unknown>,
  options?: ToolCallOptions,
): Promise<ManagedToolResult<T>> {
  const result = await callToolResult(ctx, knId, name, args, options);
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
  const parsed = parseBody(text) as {
    result?: unknown;
    error?: { message: string; code?: unknown };
  };
  // Same shape, same answer as `unwrapToolResult`: a JSON-RPC error is the
  // server refusing this call, not a failure to reach it.
  if (parsed.error) {
    throw new ToolError(
      `Context-loader error: ${parsed.error.message}`,
      typeof parsed.error.code === "string" ? parsed.error.code : undefined,
    );
  }
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
