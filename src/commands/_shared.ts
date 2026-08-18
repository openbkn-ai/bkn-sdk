// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Helpers shared by command modules: client construction + output options. */
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { type BknClient, createClient } from "../client.js";
import { activePlatform, readPlatformConfig, updatePlatformConfig } from "../config/store.js";
import type { TraceContextOptions } from "../types.js";
import { InputError } from "../utils/errors.js";
import type { OutputOptions } from "../utils/output.js";

/**
 * Where a conversation id may come from, strongest first: the flag, the
 * environment, then the one a previous command on this platform opened.
 *
 * The stored one is skipped for a transient identity (`--user` / `BKN_USER`):
 * the store is keyed by the active user, so borrowing it would file one
 * identity's evidence under another's thread.
 */
function storedConversation(o: Record<string, unknown>): string | undefined {
  if (o.user ?? process.env.BKN_USER) return undefined;
  const baseUrl = platformOf(o);
  return baseUrl ? readPlatformConfig(baseUrl).conversationId : undefined;
}

/**
 * The platform this command will talk to, normalized the way the store keys it.
 * Resolved here rather than read back off the client so the conversation hook
 * below can be a plain closure over a value that already exists.
 */
export function platformOf(o: Record<string, unknown>): string | undefined {
  const baseUrl =
    (typeof o.baseUrl === "string" ? o.baseUrl : undefined) ??
    process.env.BKN_BASE_URL ??
    activePlatform();
  return baseUrl?.replace(/\/+$/, "");
}

export function traceOptionsFrom(o: Record<string, unknown>): TraceContextOptions | undefined {
  const conversationId =
    (typeof o.conversationId === "string" ? o.conversationId : undefined) ??
    process.env.BKN_CONVERSATION_ID ??
    (o.newConversation ? undefined : storedConversation(o));
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
  const client = createClient({
    baseUrl: o.baseUrl,
    token: o.token,
    user: o.user,
    businessDomain: o.bizDomain,
    insecure: o.insecure,
    ...(trace ? { trace } : {}),
    // Remember a conversation this run opens, so the next command continues the
    // same thread instead of starting a new one. Only for the active identity —
    // `storedConversation` explains why a transient `--user` is left out.
    ...(o.user || process.env.BKN_USER
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
    return JSON.parse(raw);
  } catch {
    throw new InputError("Request body is not valid JSON.");
  }
}
