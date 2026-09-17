// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Context-loader client over the agent-retrieval MCP endpoint (JSON-RPC).
 * Slim implementation: initialize → session id →
 * notifications/initialized, then tools/call. Handles plain-JSON and
 * SSE (`data:`) response bodies. Per-process session cache (5 min TTL).
 */
import { createHash } from "node:crypto";
import { createOperationTraceContext } from "../trace-context.js";
import type { RequestContext } from "../types.js";
import { withoutPreview } from "../utils/dry-run.js";
import { HttpError, InputError, ToolError, readableServerError } from "../utils/errors.js";
import { parseBigIntJSON, stringifyBigIntJSON } from "../utils/json-bigint.js";
import { validateQueryObjectInstanceArgs } from "../utils/query-object-instance-args.js";
import { authFetch } from "./auth-fetch.js";
import { buildHeaders } from "./headers.js";
import { request } from "./http.js";
import {
  requestContextForBusinessContext,
  requireKnownLifecycleCapability,
  toWireBknContext,
  withManagedLifecycle,
} from "./lifecycle.js";
import { tlsFetch } from "./tls.js";
import type { EvidenceDurability, LifecycleBusinessRef } from "./trace-lifecycle.js";
import { ensureCompatible, inheritVersionCheck } from "./version-check.js";

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

function transportSessionKey(ctx: RequestContext, knId: string): string {
  const identity = createHash("sha256")
    .update(`bkn-context-transport:v1\0${ctx.token}`)
    .digest("hex")
    .slice(0, 16);
  return `${mcpUrl(ctx)}\0${knId}\0${identity}`;
}

function operationContext(ctx: RequestContext): RequestContext {
  return ctx.trace
    ? inheritVersionCheck(ctx, { ...ctx, trace: createOperationTraceContext(ctx.trace) })
    : ctx;
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
  await ensureCompatible(ctx, new URL(mcpUrl(ctx)));
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
      tlsFetch(ctx, mcpUrl(ctx), {
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
  const key = transportSessionKey(ctx, knId);
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

/**
 * The receipt a managed MCP tool result carries.
 *
 * Since foundry #1417 a completed call carries only what an agent reads off it: status,
 * durability and evidence references, plus `partial_reasons` when Core set any. The identity
 * fields still arrive on pending and terminal-replay replies, and on deploys older than that
 * change, so they are optional here rather than gone. Core keeps the complete receipt; read it
 * with `openbkn trace interactions operations <interaction-id>`.
 */
export interface ToolReceipt {
  receipt_status: "pending" | "completed" | "failed";
  evidence_durability?: EvidenceDurability;
  observed_evidence_refs?: string[];
  business_refs?: LifecycleBusinessRef[];
  partial_reasons?: string[];
  receipt_id?: string;
  conversation_id?: string;
  interaction_id?: string;
  operation_id?: string;
  [field: string]: unknown;
}

export interface ManagedToolResult<T = unknown> {
  value: T;
  receipt: ToolReceipt;
}

/**
 * A managed MCP call was refused after ContextLoader had produced a trusted
 * receipt. The error keeps that receipt so callers can read its authoritative
 * terminal state without treating a replay as a successful tool result.
 */
export class ManagedToolError extends ToolError {
  readonly receipt: ToolReceipt;

  constructor(message: string, code: string | undefined, receipt: ToolReceipt) {
    super(message, code);
    this.name = "ManagedToolError";
    this.receipt = receipt;
  }
}

/** Adapter-owned MCP metadata for lifecycle-safe host retries. */
export interface ToolCallOptions {
  hostConversationKey?: string;
  clientInvocationId?: string;
}

interface UnwrappedToolResult {
  value: unknown;
  receipt?: ToolReceipt;
  toolError?: { message: string; code?: string };
}

const RECEIPT_STATUSES = new Set(["pending", "completed", "failed"]);
const RECEIPT_IDENTITY_FIELDS = [
  "receipt_id",
  "conversation_id",
  "interaction_id",
  "operation_id",
] as const;
const RECEIPT_LIST_FIELDS = ["observed_evidence_refs", "business_refs", "partial_reasons"] as const;

/**
 * A receipt is trusted on its status, which decides what the SDK does with the call. The
 * identity fields may be absent (see `ToolReceipt`), but one that is present has to be a
 * usable id: an empty or non-string id is a malformed receipt, not a slim one. A pending
 * receipt is the exception: its value is not ready, and `receipt_id` is the only way back to
 * it, so one without an id cannot be acted on.
 */
function isToolReceipt(value: unknown): value is ToolReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  if (!RECEIPT_STATUSES.has(receipt.receipt_status as string)) return false;
  if (receipt.receipt_status === "pending" && receipt.receipt_id === undefined) return false;
  for (const field of RECEIPT_IDENTITY_FIELDS) {
    const id = receipt[field];
    if (id !== undefined && (typeof id !== "string" || id.length === 0)) return false;
  }
  for (const field of RECEIPT_LIST_FIELDS) {
    if (receipt[field] !== undefined && !Array.isArray(receipt[field])) return false;
  }
  return true;
}

function receiptFrom(structuredContent: unknown): ToolReceipt | undefined {
  const content = structuredContent as { bkn_receipt?: unknown; receipt?: unknown } | undefined;
  const candidate = content?.bkn_receipt ?? content?.receipt;
  if (candidate === undefined) return undefined;
  if (!isToolReceipt(candidate)) {
    throw new ToolError("Context-loader returned an invalid operation receipt.", "receipt_invalid");
  }
  return candidate;
}

function toolErrorCode(structuredContent: unknown): string | undefined {
  const content = structuredContent as { code?: unknown; error?: { code?: unknown } } | undefined;
  // Nested under `error` on older deploys; `ErrorCompact` puts it at the top.
  const code = content?.error?.code ?? content?.code;
  return typeof code === "string" ? code : lifecycleCodeInText(structuredContent);
}

const LIFECYCLE_ERROR_CODES = new Set([
  "interaction_terminal",
  "interaction_required",
  "conversation_required",
  "conversation_context_conflict",
  "invalid_business_context",
]);

/** A legacy MCP error can omit structuredContent but retain a stable code prefix. */
function lifecycleCodeInText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^([a-z_]+):/.exec(value.trim());
  return match && LIFECYCLE_ERROR_CODES.has(match[1] ?? "") ? match[1] : undefined;
}

/** Unwrap a JSON-RPC result without discarding its trusted lifecycle receipt. */
function structuredBusinessValue(structuredContent: unknown): unknown {
  if (
    !structuredContent ||
    typeof structuredContent !== "object" ||
    Array.isArray(structuredContent)
  ) {
    return undefined;
  }
  const {
    bkn_receipt: _bknReceipt,
    receipt: _receipt,
    ...value
  } = structuredContent as Record<string, unknown>;
  return Object.keys(value).length > 0 ? value : undefined;
}

function unwrapToolResult(parsed: unknown, extractBusinessReceipt = true): UnwrappedToolResult {
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
  const receipt = extractBusinessReceipt ? receiptFrom(structuredContent) : undefined;
  const content = result.content;
  if (result.isError === true) {
    const raw =
      Array.isArray(content) && content[0] && typeof content[0].text === "string"
        ? content[0].text
        : "tool call failed";
    // Do not throw here. callToolResult still has to verify a receipt against
    // the caller's conversation and interaction before exposing it on a typed
    // error. The server's stable structured code wins over receipt status.
    const message = readableServerError(raw) || raw;
    const toolError = {
      message: `Context-loader error: ${message}`,
      code: toolErrorCode(structuredContent) ?? lifecycleCodeInText(message),
    };
    if (!receipt) throw new ToolError(toolError.message, toolError.code);
    return { value: null, receipt, toolError };
  }
  if (receipt?.receipt_status === "failed") {
    return {
      value: null,
      receipt,
      toolError: {
        message: "Context-loader operation receipt is failed.",
        code: "receipt_failed",
      },
    };
  }
  if (receipt?.receipt_status === "pending") return { value: null, receipt };
  if (Array.isArray(content) && content[0] && typeof content[0].text === "string") {
    try {
      return { value: parseBigIntJSON(content[0].text), receipt };
    } catch {
      if (structuredContent !== undefined) {
        return {
          value: receipt ? (structuredBusinessValue(structuredContent) ?? null) : structuredContent,
          receipt,
        };
      }
      return { value: { raw: content[0].text }, receipt };
    }
  }
  if (receipt) return { value: structuredBusinessValue(structuredContent) ?? null, receipt };
  return { value: structuredContent ?? result };
}

function throwToolError(result: UnwrappedToolResult): void {
  if (!result.toolError) return;
  if (result.receipt) {
    throw new ManagedToolError(result.toolError.message, result.toolError.code, result.receipt);
  }
  throw new ToolError(result.toolError.message, result.toolError.code);
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

interface BusinessContextIds {
  conversation_id: string;
  interaction_id: string;
}

function callerContextMatchesTrace(
  ctx: RequestContext,
  args: Record<string, unknown>,
): BusinessContextIds | undefined {
  if (args.bkn_context === undefined) return undefined;
  const business = args.bkn_context as {
    conversation_id?: unknown;
    interaction_id?: unknown;
  } | null;
  if (
    !business ||
    typeof business.conversation_id !== "string" ||
    !business.conversation_id ||
    typeof business.interaction_id !== "string" ||
    !business.interaction_id
  ) {
    throw new InputError("BKN context requires both a conversation id and an interaction id.");
  }
  const conversation = ctx.trace?.conversationId;
  const interaction = ctx.trace?.interactionId;
  if (
    (conversation && conversation !== business.conversation_id) ||
    (interaction && interaction !== business.interaction_id)
  ) {
    throw new InputError("Caller bkn_context conflicts with BKN Trace context.");
  }
  return business as BusinessContextIds;
}

/**
 * A receipt that names its conversation or interaction must name the one this call ran in.
 * A slim receipt names neither and is taken as belonging to the call that returned it — the
 * same response, over the same session, that the context was sent on.
 */
function receiptMatchesBusinessContext(
  result: UnwrappedToolResult,
  businessContext: BusinessContextIds | undefined,
): UnwrappedToolResult {
  const receipt = result.receipt;
  if (
    receipt &&
    businessContext &&
    ((receipt.conversation_id !== undefined &&
      receipt.conversation_id !== businessContext.conversation_id) ||
      (receipt.interaction_id !== undefined &&
        receipt.interaction_id !== businessContext.interaction_id))
  ) {
    throw new Error("Context-loader receipt does not match the managed context.");
  }
  return result;
}

// finalisedToolResult is intentionally invoked inside the managed lifecycle
// callback. A stale-session ToolError must be visible to withManagedLifecycle
// so it can reopen an interaction once; a receipt-bearing error is checked
// against that interaction before it becomes a ManagedToolError.
function finalizedToolResult(
  result: UnwrappedToolResult,
  businessContext: BusinessContextIds | undefined,
): UnwrappedToolResult {
  const verified = receiptMatchesBusinessContext(result, businessContext);
  throwToolError(verified);
  return verified;
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
  return unwrapToolResult(parseBody(text), !LIFECYCLE_TOOLS.has(name));
}

export async function callToolRaw(
  ctx: RequestContext,
  knId: string,
  name: string,
  args: Record<string, unknown>,
  options?: ToolCallOptions,
  timeoutMs?: number,
): Promise<unknown> {
  const result = await callToolRawResult(ctx, knId, name, args, options, timeoutMs);
  throwToolError(result);
  return result.value;
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
 * Tools whose published input schema takes `response_format` (`json` | `toon`).
 *
 * The MCP schemas default it to `toon`, which this client cannot parse into a
 * value — the result would come back as `{ raw: "<toon text>" }`. Tools absent
 * here (`execute_action`, `execute_tool`, `run_code`, `run_shell`, extension
 * tools) do not declare the argument and are left alone.
 */
const RESPONSE_FORMAT_TOOLS = new Set([
  "search_schema",
  "search_instance",
  "query_object_instance",
  "query_instance_subgraph",
  "explore_subgraph",
  "get_logic_properties_values",
  "get_action_info",
  "get_action_execution",
  "list_action_executions",
  "query_metric",
  "run_sql",
  "run_cypher",
  "list_knowledge_networks",
  "get_kn_detail",
  "get_object_types",
  "get_relation_types",
  "list_resources",
  "describe_resource",
  "list_skills",
  "get_skill_content",
  "read_skill_file",
  "search_capabilities",
]);

/**
 * Tools whose `kn_id` argument names the network the call addresses.
 *
 * Several (`run_cypher`, `search_capabilities`, `execute_tool`, the skill
 * readers) require it in the body; the rest accept the `x-kn-id` header as an
 * alternative, where the body wins. Excluded on purpose: tools with no `kn_id`
 * (`run_sql`, `describe_resource`, `list_skills`, `list_knowledge_networks`,
 * `run_code`, `run_shell`) and `list_resources`, where `kn_id` narrows an
 * account-wide listing to one network's bindings and so changes the answer.
 */
const KN_SCOPED_TOOLS = new Set([
  "search_schema",
  "search_instance",
  "query_object_instance",
  "query_instance_subgraph",
  "explore_subgraph",
  "get_logic_properties_values",
  "get_action_info",
  "execute_action",
  "get_action_execution",
  "list_action_executions",
  "query_metric",
  "run_cypher",
  "get_kn_detail",
  "get_object_types",
  "get_relation_types",
  "get_skill_content",
  "read_skill_file",
  "execute_skill",
  "search_capabilities",
  "execute_tool",
]);

/**
 * Fill the arguments the contract expects and the SDK already knows: `kn_id`
 * from the network the call is bound to, and `response_format: "json"` so the
 * result parses. A value the caller supplied always wins.
 */
export function withContractDefaults(
  knId: string,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(KN_SCOPED_TOOLS.has(name) && knId ? { kn_id: knId } : {}),
    ...(RESPONSE_FORMAT_TOOLS.has(name) ? { response_format: "json" } : {}),
    ...args,
  };
}

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
  requireReceipt = false,
): Promise<UnwrappedToolResult> {
  if (LIFECYCLE_TOOLS.has(name)) return callToolRawResult(ctx, knId, name, args, options);
  const callerContext = callerContextMatchesTrace(ctx, args);
  const toolArgs = withContractDefaults(knId, name, args);
  // A caller that built its own `bkn_context` keeps its ids, and no session is
  // opened on its behalf; `parent_operation_id` / `causation_event_ids` /
  // `business_refs` travel with it. Anything `BKNContext` does not accept —
  // an `operation_key` minted by `ManagedTrace` in particular — is dropped:
  // Context Loader derives the Operation identity itself and rejects it.
  if (callerContext) {
    const bknContext = toWireBknContext(callerContext);
    return finalizedToolResult(
      await callToolRawResult(
        requestContextForBusinessContext(ctx, bknContext),
        knId,
        name,
        { ...toolArgs, bkn_context: bknContext },
        options,
      ),
      callerContext,
    );
  }
  if (requireReceipt) await requireKnownLifecycleCapability(ctx);
  return withManagedLifecycle(
    ctx,
    knId,
    questionFor(name, args),
    (bknContext, requestContext) =>
      callToolRawResult(
        requestContext,
        knId,
        name,
        bknContext ? { ...toolArgs, bkn_context: bknContext } : toolArgs,
        options,
      ).then((result) => finalizedToolResult(result, bknContext)),
    requireReceipt,
  );
}

export async function callTool(
  ctx: RequestContext,
  knId: string,
  name: string,
  args: Record<string, unknown>,
  options?: ToolCallOptions,
): Promise<unknown> {
  const result = await callToolResult(ctx, knId, name, args, options);
  throwToolError(result);
  return result.value;
}

/**
 * Tools whose `query` argument is a statement in a query language rather than the
 * user's words. Recording it as the interaction's question would put machine text
 * where Trace expects a person's question, so these are recorded by name, as
 * `run_sql` (whose statement is `sql`) already is.
 */
const STATEMENT_QUERY_TOOLS = new Set(["run_cypher"]);

/** The interaction's recorded question: the user's own words when the tool has them. */
function questionFor(name: string, args: Record<string, unknown>): string {
  if (STATEMENT_QUERY_TOOLS.has(name)) return name;
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
  const result = await callToolResult(ctx, knId, name, args, options, true);
  throwToolError(result);
  if (!result.receipt) {
    throw new ToolError(
      "Context-loader managed tool response did not include bkn_receipt",
      "receipt_missing",
    );
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

/** A concept kind `search_schema` can return. */
export type SchemaConceptKind = "object" | "relation" | "action" | "metric";

const SCHEMA_CONCEPT_KINDS: readonly SchemaConceptKind[] = [
  "object",
  "relation",
  "action",
  "metric",
];

/**
 * `search_scope` (`SearchSchemaScope` in schema-search.yaml). Every include flag
 * defaults to `true` on the server; they cannot all be `false`.
 */
export interface SearchSchemaScope {
  /** Concept-group ids to confine recall to; ids come from `get_kn_detail`. */
  conceptGroups?: string[];
  includeObjectTypes?: boolean;
  includeRelationTypes?: boolean;
  includeActionTypes?: boolean;
  includeMetricTypes?: boolean;
}

export interface SearchSchemaOptions {
  /**
   * Narrow what comes back. The `SchemaConceptKind[]` form is the pre-contract
   * shape, still accepted: the listed kinds are included and the rest excluded.
   */
  searchScope?: SearchSchemaScope | SchemaConceptKind[];
  maxConcepts?: number;
  /** Trimmed schema (the MCP default is `true`); `false` adds comments, keys and tags. */
  schemaBrief?: boolean;
  /** Re-rank relation types (server default `true`). */
  enableRerank?: boolean;
  /** Override the deploy's rerank model. Operator escape hatch — leave unset. */
  rerankModel?: string;
  /** Add each data property's physical `column`, which `run_sql` needs. */
  includeColumns?: boolean;
}

/**
 * Turn a list of concept kinds into the contract's include flags: listed kinds
 * on, the rest off. An empty list or an unknown kind is refused here rather
 * than as the server's 400.
 */
export function scopeFromKinds(kinds: readonly string[]): SearchSchemaScope {
  const unknown = kinds.filter((k) => !SCHEMA_CONCEPT_KINDS.includes(k as SchemaConceptKind));
  if (unknown.length > 0) {
    throw new InputError(
      `Unknown concept kind: ${unknown.join(", ")} (expected ${SCHEMA_CONCEPT_KINDS.join(", ")})`,
    );
  }
  if (kinds.length === 0) {
    throw new InputError(
      `At least one concept kind is required (${SCHEMA_CONCEPT_KINDS.join(", ")})`,
    );
  }
  return {
    includeObjectTypes: kinds.includes("object"),
    includeRelationTypes: kinds.includes("relation"),
    includeActionTypes: kinds.includes("action"),
    includeMetricTypes: kinds.includes("metric"),
  };
}

function wireSearchScope(scope: SearchSchemaScope): Record<string, unknown> | undefined {
  const wire: Record<string, unknown> = {};
  if (scope.conceptGroups?.length) wire.concept_groups = scope.conceptGroups;
  if (scope.includeObjectTypes !== undefined) wire.include_object_types = scope.includeObjectTypes;
  if (scope.includeRelationTypes !== undefined) {
    wire.include_relation_types = scope.includeRelationTypes;
  }
  if (scope.includeActionTypes !== undefined) wire.include_action_types = scope.includeActionTypes;
  if (scope.includeMetricTypes !== undefined) wire.include_metric_types = scope.includeMetricTypes;
  if (
    wire.include_object_types === false &&
    wire.include_relation_types === false &&
    wire.include_action_types === false &&
    wire.include_metric_types === false
  ) {
    throw new InputError("search_scope cannot exclude every concept kind.");
  }
  return Object.keys(wire).length > 0 ? wire : undefined;
}

export async function searchSchema(
  ctx: RequestContext,
  knId: string,
  query: string,
  opts: SearchSchemaOptions = {},
): Promise<unknown> {
  const args: Record<string, unknown> = { query, response_format: "json" };
  if (opts.searchScope) {
    const scope = Array.isArray(opts.searchScope)
      ? scopeFromKinds(opts.searchScope)
      : opts.searchScope;
    const wire = wireSearchScope(scope);
    if (wire) args.search_scope = wire;
  }
  if (opts.maxConcepts !== undefined) args.max_concepts = opts.maxConcepts;
  if (opts.schemaBrief !== undefined) args.schema_brief = opts.schemaBrief;
  if (opts.enableRerank !== undefined) args.enable_rerank = opts.enableRerank;
  if (opts.rerankModel) args.rerank_model = opts.rerankModel;
  if (opts.includeColumns !== undefined) args.include_columns = opts.includeColumns;
  return callTool(ctx, knId, "search_schema", args);
}

export function queryObjectInstance(
  ctx: RequestContext,
  knId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  validateQueryObjectInstanceArgs(args, knId);
  return callTool(ctx, knId, "query_object_instance", args);
}

/** Capability kinds a knowledge network can mount. `function` covers API tools too; split those
 * apart with `metadataTypes`. */
export type CapabilityType = "skill" | "function" | "mcp_tool";

/** One ranking over every kind the network mounted (bkn-foundry#1370).
 *
 * Replaces find_skills and search_tools, which were this call with the kinds pinned and were
 * removed in bkn-foundry#1401. */
export function searchCapabilities(
  ctx: RequestContext,
  knId: string,
  opts: {
    query?: string;
    types?: CapabilityType[];
    metadataTypes?: ("openapi" | "function")[];
    ownerId?: string;
    limit?: number;
  } = {},
): Promise<unknown> {
  const args: Record<string, unknown> = {};
  if (opts.query !== undefined) args.query = opts.query;
  if (opts.types?.length) args.types = opts.types;
  if (opts.metadataTypes?.length) args.metadata_types = opts.metadataTypes;
  if (opts.ownerId !== undefined) args.owner_id = opts.ownerId;
  if (opts.limit !== undefined) args.limit = opts.limit;
  return callTool(ctx, knId, "search_capabilities", args);
}

/** Progressive KN-detail disclosure level: `summary` (skeleton + property name/type) | `full`. */
export type DetailLevel = "summary" | "full";

/**
 * get_kn_detail — the KN schema at a chosen detail level. `summary` (the server
 * default) returns the skeleton + per-property `name/type` only — no
 * display_name, comment, field mapping, query operators or mapping rules;
 * `full` returns everything (still deduped). Drill into specific types with
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

/** Options for {@link runCypher}. */
export interface RunCypherOptions {
  /** Knowledge network branch; the deploy reads `main` when omitted. */
  branch?: string;
  /**
   * Values for the `$name` parameters in the query. Values only: a parameter never
   * becomes a label, a relationship type or a property name.
   */
  parameters?: Record<string, unknown>;
}

/**
 * Read-only Cypher over the network's model (`run_cypher`). Labels are object types,
 * relationship types are relation types, properties are logical names — bkn-backend
 * compiles the statement, so no resource id or physical column is needed. A refusal
 * names the construct and its position; it arrives as the tool's error.
 */
export function runCypher(
  ctx: RequestContext,
  knId: string,
  query: string,
  opts?: RunCypherOptions,
): Promise<unknown> {
  const args: Record<string, unknown> = { query, response_format: "json" };
  if (opts?.branch) args.branch = opts.branch;
  if (opts?.parameters) args.parameters = opts.parameters;
  return callTool(ctx, knId, "run_cypher", args);
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
