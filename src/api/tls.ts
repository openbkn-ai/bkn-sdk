// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * TLS handling for self-signed platforms (`--insecure` / `-k`).
 *
 * Node's global `fetch` (undici) has no per-call "skip verification" option
 * that works reliably across versions, so for an insecure context we disable
 * verification process-wide via NODE_TLS_REJECT_UNAUTHORIZED. This matches the
 * legacy CLI behavior. Scope is the whole process, which is fine for a CLI run
 * (one platform per invocation); SDK consumers opt in explicitly via
 * `insecure: true`.
 *
 * TODO: move to a per-request undici dispatcher so library use does not flip a
 * global. Tracked in docs/exec-plans/tech-debt-tracker.md.
 */
import type { RequestContext } from "../types.js";

export function applyTls(ctx: RequestContext): void {
  if (ctx.insecure && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
}
