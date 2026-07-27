// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Helpers shared by command modules: client construction + output options. */
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { type BknClient, createClient } from "../client.js";
import type { TraceContextOptions } from "../types.js";
import { InputError } from "../utils/errors.js";
import type { OutputOptions } from "../utils/output.js";

/**
 * Caller-supplied BKN Trace correlation ids: global flag, then env var.
 *
 * The env fallback lives here, in the CLI layer, and deliberately not in
 * `resolveContext`: a CLI process is one call, so an exported id marks one
 * round of analysis. A long-lived SDK client resolves its context once, so
 * the same env read would pin every later request to one frozen interaction —
 * the fake grouping this feature exists to avoid. Library callers pass the
 * ids explicitly per client (or per call) instead.
 */
export function traceOptionsFrom(o: Record<string, unknown>): TraceContextOptions | undefined {
  const conversationId =
    (typeof o.conversationId === "string" ? o.conversationId : undefined) ??
    process.env.BKN_CONVERSATION_ID;
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
  return createClient({
    baseUrl: o.baseUrl,
    token: o.token,
    user: o.user,
    businessDomain: o.bizDomain,
    insecure: o.insecure,
    ...(trace ? { trace } : {}),
  });
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
