// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Run every test against an empty config store and no ambient `BKN_*`.
 *
 * The CLI resolves its inputs from flags, then the environment, then
 * `~/.bkn` — so a developer's own shell decides what a test sees. That is how
 * `conversation-reuse.test.ts` came to pass on CI and fail for anyone who had
 * exported `BKN_TOKEN`, the form the README recommends: the feature under test
 * switches itself off for a borrowed identity, and four assertions inverted.
 *
 * Fixing that file alone would have left the same trap set in three others, and
 * armed again by the next variable someone reads. So the isolation is global
 * and the list is derived from the source rather than remembered:
 *
 *     git grep -o 'BKN_[A-Z_]*' -- src | sort -u
 *
 * A test that wants one of these sets it itself; `beforeEach` gives it a clean
 * slate to set it in, and `afterEach` puts the real environment back so the
 * next file — and the developer's shell — are unaffected.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

/** Every `BKN_*` the source reads. Keep in step with the grep above. */
const CLI_ENV = [
  "BKN_BASE_URL",
  "BKN_CONFIG_DIR",
  "BKN_CONVERSATION_ID",
  "BKN_INTERACTION_ID",
  "BKN_PROFILE",
  "BKN_TOKEN",
  "BKN_TRACE_EVIDENCE_INGEST_TOKEN",
  "BKN_USER",
] as const;

let saved: Record<string, string | undefined> = {};
let store: string | undefined;

beforeEach(() => {
  saved = Object.fromEntries(CLI_ENV.map((k) => [k, process.env[k]]));
  for (const k of CLI_ENV) delete process.env[k];
  // A real directory, so a test that writes credentials writes them here and
  // not into the home directory of whoever is running the suite.
  store = mkdtempSync(join(tmpdir(), "bkn-test-store-"));
  process.env.BKN_CONFIG_DIR = store;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (store) rmSync(store, { recursive: true, force: true });
  store = undefined;
});
