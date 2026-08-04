// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Managed-lifecycle sessions for the context-loader's HTTP `/kn/*` surface.
 *
 * Deploys from 0.1.3 on reject every POST under `/kn/` whose body omits
 * `bkn_context`. The MCP transport is exempt — the server merges one
 * conversation per connection — but plain HTTP has no equivalent, so a caller
 * with no business conversation of its own (a CLI invocation, a script) fails
 * closed. Core will not hand a conversation to an end user directly either: its
 * REST surface demands a trusted gateway identity. The context-loader's MCP
 * tools are that gateway, so the route to a usable `bkn_context` runs through
 * them, and this module walks it.
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
import { randomUUID } from "node:crypto";
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

const contracts = new Map<string, Promise<Contract>>();
const sessions = new Map<string, Promise<Session>>();

/** Reset both caches. Tests only — a process never needs this. */
export function resetLifecycleCaches(): void {
  contracts.clear();
  sessions.clear();
}

/**
 * Which contract does this deploy speak? Answered from the global tool catalog,
 * which is a plain GET — no MCP session, no KN, one call per process. A probe
 * that fails answers "none": an unreachable catalog must not turn into a hard
 * error on a request that might have succeeded without any context.
 */
export function lifecycleContract(ctx: RequestContext): Promise<Contract> {
  const cached = contracts.get(ctx.baseUrl);
  if (cached) return cached;
  const probe = mcpInfo(ctx)
    .then((info): Contract => {
      const names = toolNames(info);
      if (names.includes(V1_MARKER)) return "managed-v1";
      return names.includes(V2_MARKER) ? "managed-v2" : "none";
    })
    .catch((): Contract => "none");
  contracts.set(ctx.baseUrl, probe);
  return probe;
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

async function openSession(
  ctx: RequestContext,
  knId: string,
  contract: Exclude<Contract, "none">,
  question: string,
): Promise<Session> {
  generation += 1;
  if (contract === "managed-v2") {
    // Omitting conversation_id mints a fresh conversation. Reusing the one we
    // had would be rejected whenever its interaction is still active, which is
    // exactly the state a reopen is trying to escape.
    const started = await callToolRaw(ctx, knId, V2_MARKER, { question });
    return {
      contract,
      ctx,
      knId,
      conversationId: readId(started, "conversation_id", V2_MARKER),
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
  const cached = sessions.get(ctx.baseUrl);
  if (cached) return cached;
  const opening = openSession(ctx, knId, contract, question);
  sessions.set(ctx.baseUrl, opening);
  // A failed handshake must not poison the cache for the rest of the process.
  opening.catch(() => sessions.delete(ctx.baseUrl));
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
 * in the response body, an MCP tool call in the `isError` result.
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
    sessions.delete(ctx.baseUrl);
    const reopened = await bknContextFor(ctx, knId, question);
    if (!reopened) throw err;
    return await send(reopened);
  }
}

/**
 * Release the interactions this process opened.
 *
 * Only v2 can do this cheaply: its finish takes an id and an outcome, where v1
 * demands a closure manifest enumerating every operation and receipt — v1
 * sessions are `one_shot` and left to the server's idle sweeper instead. The
 * outcome is `cancelled` because a CLI invocation has no answer artifact to
 * close over, and `completed` without one is rejected.
 *
 * Best-effort by construction: this runs while a process is shutting down,
 * where a throw would turn a successful command into a failed one.
 */
export async function releaseLifecycleSessions(): Promise<void> {
  const pending = [...sessions.values()];
  sessions.clear();
  await Promise.all(
    pending.map(async (opening) => {
      try {
        const session = await opening;
        if (session.contract !== "managed-v2") return;
        await callToolRaw(session.ctx, session.knId, "bkn_finish_interaction", {
          interaction_id: session.interactionId,
          outcome: "cancelled",
          reason: "client session ended",
        });
      } catch {
        // The interaction ages out on its own; a failed release is not the
        // command's problem.
      }
    }),
  );
}
