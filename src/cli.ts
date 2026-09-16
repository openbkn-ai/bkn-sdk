#!/usr/bin/env node
// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * `openbkn` — unified CLI for the BKN platform.
 * Thin shell: parse argv → call a resource → print. No business logic here.
 */
import { runCli } from "./cli-run.js";

// `openbkn describe | head` closes the pipe while we are still writing. Node
// turns that into an unhandled EPIPE and a stack trace; for a CLI it just means
// the reader had enough.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

await runCli();
