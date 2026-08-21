// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Helpers shared by command modules: client construction + output options. */
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { type BknClient, createClient } from "../client.js";
import { activePlatform, readPlatformConfig, updatePlatformConfig } from "../config/store.js";
import type { TraceContextOptions } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import type { OutputOptions } from "../utils/output.js";

/**
 * The platform this command will talk to, normalized the way the store keys it.
 * Resolved from the options rather than read back off a built client, so the
 * conversation hook below can close over a value that already exists.
 */
export function platformOf(o: Record<string, unknown>): string | undefined {
  const baseUrl =
    (typeof o.baseUrl === "string" ? o.baseUrl : undefined) ??
    process.env.BKN_BASE_URL ??
    activePlatform();
  return baseUrl?.replace(/\/+$/, "");
}

/**
 * Whether this command runs as an identity picked for it alone.
 *
 * The remembered conversation is keyed by the active user, so a transient
 * identity neither joins that thread nor writes to it — either would file one
 * identity's evidence under another's. Read and write must agree on the answer,
 * hence one function: an earlier draft asked `??` on one side and `||` on the
 * other, so `--user ""` skipped the read and still wrote.
 *
 * `--token` counts too. Identity here is the token — `resolveContext` uses an
 * explicit one instead of any stored credential, and the session cache keys on
 * its hash — while the store is partitioned by the *active user*, who may be
 * someone else entirely.
 */
function transientIdentity(o: Record<string, unknown>): boolean {
  return Boolean(o.user || process.env.BKN_USER || o.token || process.env.BKN_TOKEN);
}

export type ConversationSource = "flag" | "env" | "stored" | "none";

/**
 * Which conversation this command will use and where it came from — the single
 * answer `traceOptionsFrom` acts on and `context conversation` reports. Two
 * copies of this precedence would drift, and the reporting copy is the one a
 * user consults when the other surprises them.
 */
export function conversationSource(o: Record<string, unknown>): {
  id?: string;
  source: ConversationSource;
} {
  const flag = typeof o.conversationId === "string" ? o.conversationId : undefined;
  if (flag) return { id: flag, source: "flag" };
  const env = process.env.BKN_CONVERSATION_ID;
  if (env) return { id: env, source: "env" };
  if (o.newConversation || transientIdentity(o)) return { source: "none" };
  const baseUrl = platformOf(o);
  const stored = baseUrl ? readPlatformConfig(baseUrl).conversationId : undefined;
  return stored ? { id: stored, source: "stored" } : { source: "none" };
}

export function traceOptionsFrom(o: Record<string, unknown>): TraceContextOptions | undefined {
  // Only a conversation the caller named. A remembered one travels as
  // `rememberedConversationId`, which the lifecycle may drop and replace — a
  // named one it must not.
  const found = conversationSource(o);
  const conversationId = found.source === "stored" ? undefined : found.id;
  const interactionId =
    (typeof o.interactionId === "string" ? o.interactionId : undefined) ??
    process.env.BKN_INTERACTION_ID;
  if (!conversationId && !interactionId) return undefined;
  return {
    ...(conversationId ? { conversationId } : {}),
    ...(interactionId ? { interactionId } : {}),
  };
}

/** Build a client from a command's merged (global + local) options. */
export function clientFrom(cmd: Command): BknClient {
  const o = cmd.optsWithGlobals();
  const trace = traceOptionsFrom(o);
  const storeBaseUrl = platformOf(o);
  const remembered = conversationSource(o);
  const client = createClient({
    baseUrl: o.baseUrl,
    token: o.token,
    user: o.user,
    businessDomain: o.bizDomain,
    insecure: o.insecure,
    ...(trace ? { trace } : {}),
    ...(remembered.source === "stored" && remembered.id
      ? { rememberedConversationId: remembered.id }
      : {}),
    // Remember a conversation this run opens, so the next command continues the
    // same thread instead of starting a new one. Only for the active identity —
    // `transientIdentity` explains which identities are left out.
    // `--new-conversation` says "for this command", so it must not replace what
    // it declined to use — otherwise one run with the flag would silently end
    // the thread every other run was continuing.
    ...(transientIdentity(o) || o.newConversation
      ? {}
      : {
          onConversationOpened: (conversationId: string) => {
            if (!storeBaseUrl) return;
            try {
              updatePlatformConfig(storeBaseUrl, {
                conversationId,
                conversationOpenedAt: new Date().toISOString(),
              });
            } catch {
              // Remembering is a convenience; a read-only or full disk must not
              // fail a command that otherwise worked.
            }
          },
        }),
  });
  return client;
}

export function outputOptions(cmd: Command): OutputOptions {
  const o = cmd.optsWithGlobals();
  return { json: Boolean(o.json), compact: Boolean(o.compact), full: Boolean(o.full) };
}

/** Parse a comma-separated flag value into a trimmed string list. */
export function csv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Resolve a request body from `--body '<json>'` or `--body-file <path>`. */
export function readBody(opts: { body?: string; bodyFile?: string }): unknown {
  const raw = opts.bodyFile ? readFileSync(opts.bodyFile, "utf8") : opts.body;
  if (!raw) throw new InputError("Provide --body '<json>' or --body-file <path>.");
  try {
    return parseBigIntJSON(raw);
  } catch {
    throw new InputError("Request body is not valid JSON.");
  }
}
