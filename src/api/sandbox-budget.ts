// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * How long a client waits on the sandbox.
 *
 * Every endpoint that runs code — `function/execute`, `function/infer-schema`,
 * `operator/debug`, `skills/execute-sync` — blocks and sends no response header
 * until the run is over. Two deadlines therefore apply, and both have to move
 * together: the abort budget, and undici's 300s header deadline, which the
 * abort budget alone cannot lift.
 */

/**
 * The sandbox's own ceiling, used as the client's budget when the caller names
 * no limit. 300s by default, 3600s as the documented maximum
 * (`infra/sandbox/CLAUDE.md`). Budget against the maximum: a deploy may raise
 * the default, and a client that gave up first would report an abort where an
 * exit code was coming.
 *
 * Only ever a local budget — it is never sent, and it never shortens a run.
 */
export const SANDBOX_MAX_TIMEOUT_SEC = 3600;

/** Client-side budget for one run: the sandbox's limit, plus room for the round trip. */
export function sandboxBudgetMs(timeoutSec: number | undefined): number {
  return (timeoutSec ?? SANDBOX_MAX_TIMEOUT_SEC) * 1000 + 15_000;
}
