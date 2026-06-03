/** Helpers shared by command modules: client construction + output options. */
import type { Command } from "commander";
import { type BknClient, createClient } from "../client.js";
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
  return { json: Boolean(o.json), compact: Boolean(o.compact) };
}

/** Parse a comma-separated flag value into a trimmed string list. */
export function csv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
