// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Managed-lifecycle sessions for the context-loader's HTTP `/kn/*` surface.
 *
 * Deploys from 0.1.3 on reject every POST under `/kn/` whose body omits
 * `bkn_context`, and the MCP tool surface wants the same object in its tool
 * arguments. A caller with no business conversation of its own — a CLI
 * invocation, a script — therefore fails closed on both. Core will not hand a
 * conversation to an end user directly either: its REST surface demands a
 * trusted gateway identity. The context-loader's MCP tools are that gateway, so
 * the route to a usable `bkn_context` runs through them, and this module walks
 * it.
 *
 * An earlier draft of this file claimed MCP was exempt because the server
 * merges one conversation per connection. That fallback exists, but it is a
 * fallback: a connection that supplies its own context is taken at its word,
 * and supplying one is what makes the evidence land on a nameable turn rather
 * than an anonymous per-connection bucket.
 *
 * The contract (context-loader `mcp.yaml`) is two tools: `bkn_start_interaction`
 * mints the conversation and interaction ids, `bkn_finish_interaction` ends the
 * interaction. `bkn_context` is `BKNContext` (`additionalProperties: false`): the
 * two ids plus the optional causality fields. Operation identity is derived
 * server-side, so callers never send an `operation_key`.
 *
 * A deploy whose catalog lacks `bkn_start_interaction` needs no context; sending
 * none keeps working exactly as before. Once the tool is advertised, however, a
 * failed handshake is authoritative and is surfaced.
 */
import { createHash } from "node:crypto";
import type { RequestContext } from "../types.js";
import { HttpError, InputError, ToolError } from "../utils/errors.js";
import { callToolRaw, mcpInfo } from "./context-loader.js";
import { inheritVersionCheck } from "./version-check.js";

/**
 * The body field the lifecycle middleware reads. Snake_case: it goes on the wire.
 *
 * Mirrors `BKNContext` in the context-loader contract (`_shared/common.yaml`),
 * which is `additionalProperties: false`.
 */
export interface BknContext {
  conversation_id: string;
  interaction_id: string;
  parent_operation_id?: string;
  causation_event_ids?: string[];
  business_refs?: Array<{ ref_type: string; ref_id: string; version?: string }>;
}

/** The keys `BKNContext` accepts. Anything else is rejected by a strict deploy. */
const WIRE_BKN_CONTEXT_KEYS = [
  "conversation_id",
  "interaction_id",
  "parent_operation_id",
  "causation_event_ids",
  "business_refs",
] as const;

/**
 * Reduce a caller-built `bkn_context` to the fields the contract accepts.
 *
 * Context Loader derives the Operation identity itself and `BKNContext` is
 * `additionalProperties: false`, so forwarding any other key — an
 * `operation_key` from an older caller included — would get the call refused.
 */
export function toWireBknContext(bknContext: object): BknContext {
  const source = bknContext as Record<string, unknown>;
  const wire: Record<string, unknown> = {};
  for (const key of WIRE_BKN_CONTEXT_KEYS) {
    if (source[key] !== undefined) wire[key] = source[key];
  }
  return wire as unknown as BknContext;
}

/** Whether a deploy speaks the managed lifecycle, decided from its tool catalog. */
type LifecycleCapability = "managed" | "unsupported" | "unknown";

interface Lifecycle {
  capability: LifecycleCapability;
}

interface Session {
  conversationId: string;
  interactionId: string;
  /** Kept so the session can be released later without the caller threading them back. */
  ctx: RequestContext;
  knId: string;
}

const START_TOOL = "bkn_start_interaction";
const FINISH_TOOL = "bkn_finish_interaction";

/**
 * Errors that mean "the session is gone, open a new one": a conversation swept
 * for being idle takes its interaction with it, and a long-lived client
 * outlives both.
 */
const STALE_SESSION_CODES = new Set([
  "conversation_required",
  // Trace Core's lifecycleError enum (agent-observability.yaml): a conversation
  // that was closed, swept, or never existed takes its interaction with it.
  "conversation_not_found",
  "conversation_closed",
  "conversation_expired",
  "interaction_required",
  "interaction_terminal",
  "interaction_in_progress",
]);

/**
 * Default attribution, so an SDK-opened conversation is identifiable in Trace.
 * A caller overrides it with `ClientOptions.agentName`; the contract asks for the
 * same name on every start within one conversation, so it is fixed per client.
 */
const DEFAULT_AGENT_NAME = "openbkn-sdk";

/** `startInteractionRequest.agent_name` is `maxLength: 128` (agent-observability.yaml). */
export const MAX_AGENT_NAME_LENGTH = 128;

function agentNameFor(ctx: RequestContext): string {
  const name = ctx.agentName?.trim() || DEFAULT_AGENT_NAME;
  // Checked locally: the server's `agent_name_invalid` would otherwise arrive on
  // every managed call, naming a handshake the caller never made.
  if ([...name].length > MAX_AGENT_NAME_LENGTH) {
    throw new InputError(
      `agentName must be at most ${MAX_AGENT_NAME_LENGTH} characters (got ${[...name].length}).`,
    );
  }
  return name;
}

/**
 * Releasing a session happens on the way out of a process, after the result is
 * already printed. The MCP transport has no timeout of its own, so without this
 * a wedged server would leave the command hanging with nothing left to say.
 */
const RELEASE_TIMEOUT_MS = 3_000;

const contracts = new Map<string, Promise<Lifecycle>>();

/**
 * How long a failed probe stays failed.
 *
 * Not caching it at all means a deploy whose `/mcp/info` is durably gone pays
 * a doomed round trip per business call — or worse, waits out the request
 * timeout each time, where before only the first call did. Caching it forever
 * lets one blip decide the rest of the process. A short window does both jobs.
 *
 * Recorded per caller, not per deploy. The probe carries `ctx.token`, so a 401
 * is a fact about one identity; filing it under the base URL alone would let
 * one expired token answer "no lifecycle here" for every other identity using
 * that host. Same distinction the session key draws — that one decides whose
 * session a request joins, this one decides whose failure it inherits.
 */
const PROBE_FAILURE_TTL_MS = 30_000;
const probeFailures = new Map<string, number>();
const sessions = new Map<string, Promise<Session>>();

/** Reset both caches. Tests only — a process never needs this. */
export function resetLifecycleCaches(): void {
  contracts.clear();
  probeFailures.clear();
  sessions.clear();
}

/**
 * Which contract does this deploy speak? Answered from the global tool catalog,
 * which is a plain GET — no MCP session, no KN, one call per process. An
 * unreachable or malformed catalog is distinct from a catalog that explicitly
 * lacks lifecycle tools: ordinary calls preserve the old best-effort fallback,
 * while receipt-required calls must not mistake uncertainty for legacy support.
 */
const MANAGED_LIFECYCLE: Lifecycle = { capability: "managed" };
const NO_LIFECYCLE: Lifecycle = { capability: "unsupported" };
const UNKNOWN_LIFECYCLE: Lifecycle = { capability: "unknown" };

/**
 * The raw catalog probe. Receipt callers need an authentication failure to stay
 * actionable, while ordinary calls preserve their longstanding best-effort
 * fallback through {@link lifecycleFor} below.
 */
function lifecycleProbeFor(ctx: RequestContext): Promise<Lifecycle> {
  const failureKey = `${ctx.baseUrl}\0${identityOf(ctx)}`;
  const failedAt = probeFailures.get(failureKey);
  if (failedAt !== undefined) {
    if (Date.now() - failedAt < PROBE_FAILURE_TTL_MS) return Promise.resolve(UNKNOWN_LIFECYCLE);
    probeFailures.delete(failureKey);
  }
  let pending = contracts.get(failureKey);
  if (!pending) {
    pending = mcpInfo(ctx).then((info): Lifecycle => {
      const names = toolNames(info);
      if (!names) {
        // A malformed 200 response is as inconclusive as a rejected probe. Do
        // not let it decide a long-lived process permanently, but avoid a new
        // doomed round trip for every business call in this short window.
        contracts.delete(failureKey);
        probeFailures.set(failureKey, Date.now());
        return UNKNOWN_LIFECYCLE;
      }
      return names.includes(START_TOOL) ? MANAGED_LIFECYCLE : NO_LIFECYCLE;
    });
    contracts.set(failureKey, pending);
    // Same rule the session cache follows: a probe that failed is not a lasting
    // answer about the deploy, only about that moment. Keeping it would let one
    // blip — a 502, a token mid-refresh — decide that every later call in this
    // process goes out without a `bkn_context`, and the reopen path cannot
    // recover from that, since it sees no context to reopen.
    pending.catch((err: unknown) => {
      contracts.delete(failureKey);
      // An authorization failure is not worth a window at all: a refresh can
      // fix it on the very next call, and holding it would spend 30s answering
      // from a credential that has already been replaced.
      if (!isAuthFailure(err)) probeFailures.set(failureKey, Date.now());
    });
  }
  return pending;
}

export function lifecycleFor(ctx: RequestContext): Promise<Lifecycle> {
  return lifecycleProbeFor(ctx).catch((): Lifecycle => UNKNOWN_LIFECYCLE);
}

function isAuthFailure(err: unknown): boolean {
  return err instanceof HttpError && (err.status === 401 || err.status === 403);
}

function toolNames(info: unknown): string[] | undefined {
  const tools = (info as { tools?: Array<{ name?: unknown }> } | undefined)?.tools;
  if (!Array.isArray(tools)) return undefined;
  return tools.flatMap((tool) => (typeof tool?.name === "string" ? [tool.name] : []));
}

export async function requireKnownLifecycleCapability(ctx: RequestContext): Promise<void> {
  try {
    if ((await lifecycleProbeFor(ctx)).capability !== "unknown") return;
  } catch (err) {
    // Do not turn a credential failure into a generic retry hint. HttpError
    // carries the CLI's established authentication diagnosis and exit status.
    if (isAuthFailure(err)) throw err;
  }
  throw new ToolError(
    "Context-loader lifecycle capability is unavailable; retry when the catalog can be read.",
    "lifecycle_capability_unknown",
  );
}

/**
 * A caller that already owns a conversation always wins: it has a real business
 * turn to bind evidence to, which is worth more than anything we could open.
 */
function callerOwnedSession(
  ctx: RequestContext,
): Pick<Session, "conversationId" | "interactionId"> | undefined {
  const conversationId = ctx.trace?.conversationId;
  const interactionId = ctx.trace?.interactionId;
  return conversationId && interactionId ? { conversationId, interactionId } : undefined;
}

function readId(result: unknown, field: string, tool: string): string {
  const value = (result as Record<string, unknown> | undefined)?.[field];
  if (typeof value !== "string" || !value) {
    throw new Error(`Managed lifecycle: ${tool} returned no ${field}.`);
  }
  return value;
}

/**
 * A conversation the caller named but did not pair with an interaction.
 *
 * `bkn_start_interaction` can open an interaction inside an existing
 * conversation, so this is a supported input, not an incomplete one — `--conversation-id` and
 * `--interaction-id` are independent flags. Opening a fresh conversation here
 * instead would file the evidence somewhere the caller never asked for, without
 * saying so.
 */
function callerNamedConversation(ctx: RequestContext): string | undefined {
  return ctx.trace?.interactionId ? undefined : ctx.trace?.conversationId;
}

/**
 * Could this failure be the deploy rejecting *this conversation*?
 *
 * The retry below is worth a second handshake only then. The rule is that a
 * failure which will repeat identically must not be paid for twice, and each
 * handshake opens its own MCP session — so with something stored, a deploy that
 * is down or a credential that has expired would otherwise cost every command
 * double.
 *
 * A refusal reaches here as a `ToolError` — an MCP `isError` result, or a
 * JSON-RPC error from a gateway that validates before dispatch — or as a 4xx.
 * Three 4xx are excluded: auth, because the credential is unchanged on the
 * retry, and 408/429, because they describe the request rather than its
 * arguments. Those two are also the only 4xx where a retry can *succeed*, which
 * would trade a conversation that was fine for a new one and overwrite whatever
 * the caller had stored.
 *
 * Everything else — 5xx, a transport failure, a malformed body, a missing
 * session id — is about reaching the deploy at all, never about which
 * conversation was named.
 */
function refusesThisConversation(err: unknown): boolean {
  if (err instanceof ToolError) return true;
  if (!(err instanceof HttpError) || isAuthFailure(err)) return false;
  if (err.status === 408 || err.status === 429) return false;
  return err.status >= 400 && err.status < 500;
}

/**
 * The conversation a fresh session should join, if any.
 *
 * A caller-named one and a remembered one look the same to the server; they
 * differ in what a failure means. `ensureSession` drops the remembered one and
 * tries again, because it offered convenience, not intent.
 */
function joinTarget(ctx: RequestContext): string | undefined {
  return callerNamedConversation(ctx) ?? ctx.rememberedConversationId;
}

async function openSession(ctx: RequestContext, knId: string, question: string): Promise<Session> {
  const named = joinTarget(ctx);
  // Without a conversation_id the server mints a fresh conversation, so only a
  // conversation being joined is passed in. `conversation_mode` is `continue`
  // exactly then and `new` otherwise; it, `question` and `agent_name` are
  // required on every start (context-loader mcp.yaml).
  const started = await callToolRaw(ctx, knId, START_TOOL, {
    question,
    conversation_mode: named ? "continue" : "new",
    agent_name: agentNameFor(ctx),
    ...(named ? { conversation_id: named } : {}),
  });
  return {
    ctx,
    knId,
    conversationId: readId(started, "conversation_id", START_TOOL),
    interactionId: readId(started, "interaction_id", START_TOOL),
  };
}

/**
 * A session belongs to one KN, one caller, and one named conversation.
 *
 * The KN because the conversation is opened over an MCP session bound to
 * `x-kn-id`; the identity because an embedder can drive one base URL with a
 * different token per user, and reusing a session across them would file one
 * user's evidence under another's business turn — and later release it with the
 * wrong credential. The token is hashed rather than stored: this key ends up in
 * a long-lived map, and a bearer token does not belong there.
 *
 * The named conversation because a caller that asked for `conv_B` must not be
 * handed an interaction on `conv_A`. The other two dimensions protect a caller
 * who said nothing; this one protects a caller who said something specific,
 * which is the worse of the two to ignore.
 *
 * Parts are joined on NUL, written as the two-character escape so the file
 * stays plain ASCII. A separator that cannot occur inside a part is the point:
 * with a space, `token="a b"` + `domain="c"` and `token="a"` + `domain="b c"`
 * hash the same. Unreachable in practice, but this key decides whose session a
 * request joins.
 */
function identityOf(ctx: RequestContext): string {
  return createHash("sha256").update(ctx.token).digest("hex").slice(0, 16);
}

function sessionKey(ctx: RequestContext, knId: string): string {
  // Both conversation inputs belong in the key for the same reason: a caller
  // that asked for one must not be handed an interaction on another.
  const wanted = ctx.trace?.conversationId ?? ctx.rememberedConversationId ?? "";
  return `${ctx.baseUrl}\0${knId}\0${identityOf(ctx)}\0${wanted}`;
}

/**
 * The session is cached as a promise so concurrent first calls share one
 * handshake — a conversation permits a single active interaction, so two racing
 * opens would leave one of them rejected.
 */
function ensureSession(ctx: RequestContext, knId: string, question: string): Promise<Session> {
  const key = sessionKey(ctx, knId);
  const cached = sessions.get(key);
  if (cached) return cached;
  // A remembered conversation may have been swept, or may still hold an active
  // interaction — a conversation permits one at a time. Either way it is this
  // caller's own convenience failing, so drop it and open a fresh one rather
  // than failing the command: without this, one unusable id would break every
  // later run, and the reopen path in `withManagedLifecycle` cannot help. That
  // path needs a context to retry with, and a handshake that throws prevents
  // `bknContextFor` from returning one to retry with.
  // "This session is joining the remembered conversation" — asked as the reason,
  // not as a value comparison. A caller that names the same id it also stored
  // still named it, and a named conversation must never be swapped out from
  // under them.
  const remembered = callerNamedConversation(ctx) ? undefined : joinTarget(ctx);
  const opening = remembered
    ? openSession(ctx, knId, question).catch((err: unknown) => {
        if (!refusesThisConversation(err)) throw err;
        const { rememberedConversationId: _dropped, ...fresh } = ctx;
        return openSession(inheritVersionCheck(ctx, fresh), knId, question);
      })
    : openSession(ctx, knId, question);
  // Report only a conversation this call minted. One the caller named is
  // already theirs to keep, and echoing it back would let a `--conversation-id`
  // meant for a single command quietly become the stored default.
  if (!callerNamedConversation(ctx)) {
    opening
      .then((session) => {
        // Joining a remembered conversation returns the same id; reporting it
        // would restamp its age and make "opened at" mean "last used at".
        if (session.conversationId === ctx.rememberedConversationId) return;
        ctx.onConversationOpened?.(session.conversationId);
      })
      .catch(() => {
        /* the handshake failure is surfaced by the caller awaiting `opening` */
      });
  }
  sessions.set(key, opening);
  // A failed handshake must not poison the cache for the rest of the process.
  opening.catch(() => sessions.delete(key));
  return opening;
}

function contextFor(session: Pick<Session, "conversationId" | "interactionId">): BknContext {
  return { conversation_id: session.conversationId, interaction_id: session.interactionId };
}

/**
 * A complete business context is authoritative for its operation. An
 * interaction-only trace header is a second, incomplete context channel, so
 * omit it for every path that supplies a full `bkn_context`.
 */
export function requestContextForBusinessContext(
  ctx: RequestContext,
  bknContext: BknContext | undefined,
): RequestContext {
  if (!bknContext || !ctx.trace?.interactionId || ctx.trace.conversationId) return ctx;
  const { interactionId: _interactionId, ...trace } = ctx.trace;
  return inheritVersionCheck(ctx, { ...ctx, trace });
}

/** Resolve a `bkn_context` for one call, or `undefined` when no managed contract exists. */
export async function bknContextFor(
  ctx: RequestContext,
  knId: string,
  question: string,
  requireKnownCapability = false,
): Promise<BknContext | undefined> {
  const lifecycle = await lifecycleFor(ctx);
  if (lifecycle.capability === "unknown") {
    if (requireKnownCapability) await requireKnownLifecycleCapability(ctx);
    return undefined;
  }
  if (lifecycle.capability !== "managed") return undefined;

  const owned = callerOwnedSession(ctx);
  if (owned) return contextFor(owned);

  return contextFor(await ensureSession(ctx, knId, question));
}

/**
 * The server's error code, wherever it landed: an HTTP `/kn/*` call carries it
 * in the response body, an MCP call in an `isError` result or a JSON-RPC
 * top-level error — both reach here as a `ToolError`.
 *
 * Including the JSON-RPC channel is deliberate and reaches past this PR's
 * subject: any managed tool call whose refusal names a stale-session code now
 * takes the same recovery as one reported through `isError`. Same meaning, same
 * path. It is bounded — one reopen, and a top-level error means the call was
 * never dispatched, so resending has nothing to undo — and a caller-owned
 * session is still never swapped out.
 */
function serverErrorCode(err: unknown): string | undefined {
  if (err instanceof ToolError) return err.code;
  if (!(err instanceof HttpError)) return undefined;
  try {
    // Context-loader REST errors are `ErrorCompact` and Core's lifecycle errors
    // are `lifecycleError`, both with a top-level `code`; older deploys nested
    // it under `error`.
    const parsed = JSON.parse(err.body) as { code?: unknown; error?: { code?: unknown } };
    if (typeof parsed.error?.code === "string") return parsed.error.code;
    return typeof parsed.code === "string" ? parsed.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run one `/kn/*` call under a managed session, reopening once if the session
 * died between calls. The retry is bounded to a single attempt: a second
 * failure is about the request, not the session.
 */
export async function withManagedLifecycle<T>(
  ctx: RequestContext,
  knId: string,
  question: string,
  send: (bknContext: BknContext | undefined, requestContext: RequestContext) => Promise<T>,
  requireKnownCapability = false,
): Promise<T> {
  const first = await bknContextFor(ctx, knId, question, requireKnownCapability);
  try {
    return await send(first, requestContextForBusinessContext(ctx, first));
  } catch (err) {
    const code = serverErrorCode(err);
    // Only a session we opened is ours to reopen. A caller-supplied
    // conversation belongs to its owner's turn; silently replacing it would
    // detach the evidence from the business conversation it was meant for.
    if (!first || callerOwnedSession(ctx) || !code || !STALE_SESSION_CODES.has(code)) throw err;
    sessions.delete(sessionKey(ctx, knId));
    const reopened = await bknContextFor(ctx, knId, question, requireKnownCapability);
    if (!reopened) throw err;
    return await send(reopened, requestContextForBusinessContext(ctx, reopened));
  }
}

/**
 * Release the interactions this process opened.
 *
 * `bkn_finish_interaction` takes the interaction id and an outcome. The
 * outcome is `cancelled` because a
 * CLI invocation has no answer artifact to close over, and `completed` without
 * one is rejected.
 *
 * Best-effort by construction: this runs while a process is shutting down,
 * where a throw would turn a successful command into a failed one. The whole
 * release is bounded, not just its final call — the handshake being awaited
 * here has no deadline of its own, so a server that accepted the connection
 * and went quiet would hold the process open after its output was printed.
 */
export async function releaseLifecycleSessions(): Promise<void> {
  const pending = [...sessions.values()];
  sessions.clear();
  await Promise.all(pending.map((opening) => withDeadline(releaseOne(opening))));
}

/** Resolve when `work` settles or the release deadline passes, whichever is first. */
function withDeadline(work: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, RELEASE_TIMEOUT_MS);
    // Do not hold the event loop open for a release nobody is waiting on.
    timer.unref?.();
    work.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function releaseOne(opening: Promise<Session>): Promise<void> {
  try {
    const session = await opening;
    await callToolRaw(
      session.ctx,
      session.knId,
      FINISH_TOOL,
      {
        interaction_id: session.interactionId,
        outcome: "cancelled",
        reason: "client session ended",
      },
      undefined,
      RELEASE_TIMEOUT_MS,
    );
  } catch {
    // The interaction ages out on its own; a failed release is not the
    // command's problem.
  }
}
