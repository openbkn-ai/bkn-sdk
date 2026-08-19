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
 * Two incompatible contracts are in the wild and a deploy advertises which one
 * it speaks in its tool catalog:
 *
 * - `managed-v1` — `bkn_create_conversation` then `bkn_start_interaction`, and
 *   `bkn_context` carries a caller-chosen `operation_key`.
 * - `managed-v2` — one `bkn_start_interaction` mints both ids, and `bkn_context`
 *   accepts *only* the two ids; anything else is `invalid_business_context`.
 *
 * Everything here degrades to `undefined` rather than throwing. A deploy that
 * predates the middleware has neither tool and needs no context; sending none
 * must keep working exactly as before.
 */
import { createHash, randomUUID } from "node:crypto";
import type { RequestContext } from "../types.js";
import { HttpError, ToolError } from "../utils/errors.js";
import { callToolRaw, mcpInfo } from "./context-loader.js";

/** The body field the lifecycle middleware reads. Snake_case: it goes on the wire. */
export interface BknContext {
  conversation_id: string;
  interaction_id: string;
  /** v1 only. v2 rejects the field outright, so it must stay absent there. */
  operation_key?: string;
}

/** Which lifecycle contract a deploy speaks, decided from its tool catalog. */
type Contract = "none" | "managed-v1" | "managed-v2";

interface Session {
  contract: Exclude<Contract, "none">;
  conversationId: string;
  interactionId: string;
  /** Kept so the session can be released later without the caller threading them back. */
  ctx: RequestContext;
  knId: string;
}

const V1_MARKER = "bkn_create_conversation";
const V2_MARKER = "bkn_start_interaction";

/**
 * Errors that mean "the session is gone, open a new one". A v1 interaction's
 * lease is five minutes and a long-lived client outlives it; a conversation
 * swept for being idle takes its interaction with it.
 */
const STALE_SESSION_CODES = new Set([
  "conversation_required",
  "interaction_required",
  "interaction_terminal",
  "interaction_in_progress",
  "lease_expired",
  "lease_invalid",
  "lease_superseded",
]);

/**
 * One conversation per process, named so a support engineer can find it. The
 * generation suffix matters under v1: `bkn_create_conversation` is
 * ensure-current, so replaying a key returns the same conversation — and its
 * still-active interaction would reject the replacement we are trying to open.
 */
const PROCESS_ID = randomUUID();
let generation = 0;

/** Display-only attribution, so an SDK-opened conversation is identifiable in Trace. */
const AGENT_NAME = "openbkn-sdk";

/**
 * Releasing a session happens on the way out of a process, after the result is
 * already printed. The MCP transport has no timeout of its own, so without this
 * a wedged server would leave the command hanging with nothing left to say.
 */
const RELEASE_TIMEOUT_MS = 3_000;

const contracts = new Map<string, Promise<Contract>>();

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
 * one expired token answer "no lifecycle here" for every other tenant sharing
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
 * which is a plain GET — no MCP session, no KN, one call per process. A probe
 * that fails answers "none": an unreachable catalog must not turn into a hard
 * error on a request that might have succeeded without any context.
 */
export function lifecycleContract(ctx: RequestContext): Promise<Contract> {
  const failureKey = `${ctx.baseUrl}\0${identityOf(ctx)}`;
  const failedAt = probeFailures.get(failureKey);
  if (failedAt !== undefined) {
    if (Date.now() - failedAt < PROBE_FAILURE_TTL_MS) return Promise.resolve("none");
    probeFailures.delete(failureKey);
  }
  let pending = contracts.get(ctx.baseUrl);
  if (!pending) {
    pending = mcpInfo(ctx).then((info): Contract => {
      const names = toolNames(info);
      if (names.includes(V1_MARKER)) return "managed-v1";
      return names.includes(V2_MARKER) ? "managed-v2" : "none";
    });
    contracts.set(ctx.baseUrl, pending);
    // Same rule the session cache follows: a probe that failed is not a lasting
    // answer about the deploy, only about that moment. Keeping it would let one
    // blip — a 502, a token mid-refresh — decide that every later call in this
    // process goes out without a `bkn_context`, and the reopen path cannot
    // recover from that, since it sees no context to reopen.
    pending.catch((err: unknown) => {
      contracts.delete(ctx.baseUrl);
      // An authorization failure is not worth a window at all: a refresh can
      // fix it on the very next call, and holding it would spend 30s answering
      // from a credential that has already been replaced.
      if (!isAuthFailure(err)) probeFailures.set(failureKey, Date.now());
    });
  }
  // Degrade for this call regardless: an unreachable catalog must not turn into
  // a hard error on a request that might have succeeded without any context.
  return pending.catch((): Contract => "none");
}

function isAuthFailure(err: unknown): boolean {
  return err instanceof HttpError && (err.status === 401 || err.status === 403);
}

function toolNames(info: unknown): string[] {
  const tools = (info as { tools?: Array<{ name?: unknown }> } | undefined)?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => (typeof tool?.name === "string" ? [tool.name] : []));
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
 * Both contracts can open an interaction inside an existing conversation, so
 * this is a supported input, not an incomplete one — `--conversation-id` and
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
 *
 * A remembered one is honoured only under v2, mirroring the gate on reporting
 * them. Joining under v1 would produce an interaction nothing can release —
 * `releaseOne` handles only v2 — so the next call would wait out the lease. The
 * CLI never stores a v1 conversation, but this field is public, and a caller
 * passing one must not fall into the hole the write side already avoids.
 */
function joinTarget(ctx: RequestContext, contract: Exclude<Contract, "none">): string | undefined {
  const named = callerNamedConversation(ctx);
  if (named) return named;
  return contract === "managed-v2" ? ctx.rememberedConversationId : undefined;
}

async function openSession(
  ctx: RequestContext,
  knId: string,
  contract: Exclude<Contract, "none">,
  question: string,
): Promise<Session> {
  generation += 1;
  const named = joinTarget(ctx, contract);
  if (contract === "managed-v2") {
    // Without a conversation_id the server mints a fresh conversation. Reusing
    // one of our own would be rejected whenever its interaction is still
    // active, which is exactly the state a reopen is trying to escape — so only
    // a caller-named conversation is passed back in.
    const started = await callToolRaw(ctx, knId, V2_MARKER, {
      question,
      // The name is fixed when the conversation is created, so it belongs only
      // on the call that creates one. Joining a conversation the caller named
      // and relabelling it `openbkn-sdk` would rewrite their attribution — the
      // v1 join below has always omitted it, and this is the same decision.
      ...(named
        ? { conversation_id: named }
        : // Display-only, but the only thing separating a session the SDK
          // opened from a real agent's in a Trace listing.
          { agent_name: AGENT_NAME }),
    });
    return {
      contract,
      ctx,
      knId,
      conversationId: readId(started, "conversation_id", V2_MARKER),
      interactionId: readId(started, "interaction_id", V2_MARKER),
    };
  }

  if (named) {
    // Borrowed, not ours: this interaction lives in the caller's conversation,
    // which permits one active interaction at a time, so until its lease
    // expires the caller cannot open their own. `releaseLifecycleSessions`
    // cannot shorten that under v1 — `bkn_cancel_interaction` there demands a
    // `completion_manifest_version`, and Core takes that as a free-form
    // required string with no defined value to send, so a guess would fail the
    // call rather than release anything. The v1 lease is five minutes and
    // self-heals; a v2 deploy releases immediately. Revisit if a v1 deploy
    // becomes available to verify a cancel against.
    const started = await callToolRaw(ctx, knId, V2_MARKER, {
      conversation_id: named,
      idempotency_key: `start:${PROCESS_ID}:${generation}`,
      question,
    });
    return {
      contract,
      ctx,
      knId,
      conversationId: named,
      interactionId: readId(started, "interaction_id", V2_MARKER),
    };
  }

  const conversation = await callToolRaw(ctx, knId, V1_MARKER, {
    external_conversation_key: `cli:${PROCESS_ID}:${generation}`,
    // Nothing closes this conversation: a CLI invocation has no answer to close
    // over, and v1's closure manifest must enumerate every operation it
    // produced. one_shot hands it to the server's idle sweeper instead.
    one_shot: true,
  });
  const conversationId = readId(conversation, "conversation_id", V1_MARKER);
  const started = await callToolRaw(ctx, knId, V2_MARKER, {
    conversation_id: conversationId,
    idempotency_key: `start:${PROCESS_ID}:${generation}`,
    question,
  });
  return {
    contract,
    ctx,
    knId,
    conversationId,
    interactionId: readId(started, "interaction_id", V2_MARKER),
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
  return createHash("sha256")
    .update(`${ctx.token}\0${ctx.businessDomain}`)
    .digest("hex")
    .slice(0, 16);
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
function ensureSession(
  ctx: RequestContext,
  knId: string,
  contract: Exclude<Contract, "none">,
  question: string,
): Promise<Session> {
  const key = sessionKey(ctx, knId);
  const cached = sessions.get(key);
  if (cached) return cached;
  // A remembered conversation may have been swept, or may still hold an active
  // interaction — a conversation permits one at a time. Either way it is this
  // caller's own convenience failing, so drop it and open a fresh one rather
  // than failing the command: without this, one unusable id would break every
  // later run, and the reopen path in `withManagedLifecycle` cannot help. That
  // path needs a context to retry with, and a handshake that throws leaves
  // `bknContextFor` returning none at all.
  // "This session is joining the remembered conversation" — asked as the reason,
  // not as a value comparison. A caller that names the same id it also stored
  // still named it, and a named conversation must never be swapped out from
  // under them.
  const remembered = callerNamedConversation(ctx) ? undefined : joinTarget(ctx, contract);
  const opening = remembered
    ? openSession(ctx, knId, contract, question).catch((err: unknown) => {
        if (!refusesThisConversation(err)) throw err;
        const { rememberedConversationId: _dropped, ...fresh } = ctx;
        return openSession(fresh, knId, contract, question);
      })
    : openSession(ctx, knId, contract, question);
  // Report only a conversation this call minted. One the caller named is
  // already theirs to keep, and echoing it back would let a `--conversation-id`
  // meant for a single command quietly become the stored default.
  //
  // And only under v2, because only there can a caller act on it. A
  // conversation permits one active interaction, and `releaseOne` can end one
  // early only under v2 — v1's cancel wants a `completion_manifest_version`
  // with no value to send. So a v1 conversation handed to the next command
  // would be refused until the five-minute lease expired: reuse would cost
  // exactly what it set out to give.
  if (contract === "managed-v2" && !callerNamedConversation(ctx)) {
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

/**
 * A fresh v1 key per call, deliberately not derived from the input.
 *
 * Under v1 `operation_key` is an idempotency key, and Core answers a replay with
 * the recorded operation and receipt instead of the tool's payload — the receipt
 * carries only a hash, so the data is unrecoverable. Hashing the input would
 * therefore make the same query twice in one interaction return no results the
 * second time. Core computes its own normalized input hash regardless.
 */
function newOperationKey(): string {
  return `op:${randomUUID()}`;
}

function contextFor(
  session: Pick<Session, "conversationId" | "interactionId">,
  contract: Contract,
): BknContext {
  return {
    conversation_id: session.conversationId,
    interaction_id: session.interactionId,
    // v2 validates bkn_context strictly and rejects the field.
    ...(contract === "managed-v1" ? { operation_key: newOperationKey() } : {}),
  };
}

/** Resolve a `bkn_context` for one call, or `undefined` when none is needed or reachable. */
export async function bknContextFor(
  ctx: RequestContext,
  knId: string,
  question: string,
): Promise<BknContext | undefined> {
  const contract = await lifecycleContract(ctx);
  if (contract === "none") return undefined;

  const owned = callerOwnedSession(ctx);
  if (owned) return contextFor(owned, contract);

  try {
    return contextFor(await ensureSession(ctx, knId, contract, question), contract);
  } catch {
    // Fall through with no context: the server's own error names the missing
    // piece far better than a handshake failure would.
    return undefined;
  }
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
    const parsed = JSON.parse(err.body) as { error?: { code?: unknown } };
    return typeof parsed.error?.code === "string" ? parsed.error.code : undefined;
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
  send: (bknContext: BknContext | undefined) => Promise<T>,
): Promise<T> {
  const first = await bknContextFor(ctx, knId, question);
  try {
    return await send(first);
  } catch (err) {
    const code = serverErrorCode(err);
    // Only a session we opened is ours to reopen. A caller-supplied
    // conversation belongs to its owner's turn; silently replacing it would
    // detach the evidence from the business conversation it was meant for.
    if (!first || callerOwnedSession(ctx) || !code || !STALE_SESSION_CODES.has(code)) throw err;
    sessions.delete(sessionKey(ctx, knId));
    const reopened = await bknContextFor(ctx, knId, question);
    if (!reopened) throw err;
    return await send(reopened);
  }
}

/**
 * Release the interactions this process opened.
 *
 * Only v2 is released. Its finish takes an id and an outcome, where v1's
 * cancel demands a closure manifest — and the two kinds of v1 session are
 * skipped for different reasons: one we opened ourselves carries `one_shot`
 * and is swept when idle, while one opened inside a caller's conversation has
 * no `one_shot` to rely on and no manifest we can supply (see `openSession`),
 * so it waits out its five-minute lease. The outcome is `cancelled` because a
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
    if (session.contract !== "managed-v2") return;
    await callToolRaw(
      session.ctx,
      session.knId,
      "bkn_finish_interaction",
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
