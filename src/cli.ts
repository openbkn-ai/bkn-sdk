#!/usr/bin/env node
// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * `openbkn` — unified CLI for the BKN platform.
 * Thin shell: parse argv → call a resource → print. No business logic here.
 */
import { releaseLifecycleSessions } from "./api/lifecycle.js";
import { buildProgram } from "./cli-program.js";
import { formatError, toExitCode } from "./utils/errors.js";

// `openbkn describe | head` closes the pipe while we are still writing. Node
// turns that into an unhandled EPIPE and a stack trace; for a CLI it just means
// the reader had enough.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

const program = buildProgram();

// Legacy `-bd` is a 2-char short flag commander can't declare; rewrite it to
// the canonical `--biz-domain` before parsing (legacy compatibility).
const argv = process.argv.map((a) => (a === "-bd" ? "--biz-domain" : a));

try {
  await program.parseAsync(argv);
} catch (err) {
  console.error(formatError(err));
  await releaseLifecycleSessions();
  process.exit(toExitCode(err));
}

// A deploy that manages lifecycle state opened an interaction for this command,
// and a conversation permits only one at a time. Hand it back on the way out
// instead of leaving it for the server's sweeper. Best-effort, never fatal.
await releaseLifecycleSessions();
