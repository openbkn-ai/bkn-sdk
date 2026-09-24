// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** CLI execution and graceful process-exit handling. */
import { releaseLifecycleSessions } from "./api/lifecycle.js";
import { skipVersionCheck } from "./api/version-check.js";
import { buildProgram } from "./cli-program.js";
import { DryRunSignal, enableDryRun } from "./utils/dry-run.js";
import { formatError, toExitCode } from "./utils/errors.js";

/**
 * Run one CLI invocation without forcing the process to exit.
 *
 * `process.exit()` can terminate while Node's fetch transport is still closing
 * a socket. Set the exit code and let the event loop drain instead, so callers
 * retain the backend error without a libuv shutdown assertion.
 */
export async function runCli(argv = process.argv): Promise<void> {
  const program = buildProgram();

  // The flags have to be read before commander parses, because each switch must
  // be on by the time a resource builds its first request.
  if (argv.includes("--dry-run")) enableDryRun();
  if (argv.includes("--skip-version-check")) skipVersionCheck();

  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof DryRunSignal) {
      process.stdout.write(`${JSON.stringify(err.request, null, 2)}\n`);
      return;
    }
    console.error(formatError(err));
    process.exitCode = toExitCode(err);
  } finally {
    // A deploy that manages lifecycle state opened an interaction for this
    // command, and a conversation permits only one at a time. Hand it back on
    // the way out instead of leaving it for the server's sweeper. Best-effort,
    // never fatal.
    await releaseLifecycleSessions();
  }
}
