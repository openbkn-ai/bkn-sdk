// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

/** Helpers shared by command modules: client construction + output options. */
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { type BknClient, createClient } from "../client.js";
import { InputError } from "../utils/errors.js";
import type { OutputOptions } from "../utils/output.js";

/** Build a client from a command's merged (global + local) options. */
export function clientFrom(cmd: Command): BknClient {
  const o = cmd.optsWithGlobals();
  return createClient({
    baseUrl: o.baseUrl,
    token: o.token,
    user: o.user,
    businessDomain: o.bizDomain,
    insecure: o.insecure,
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
