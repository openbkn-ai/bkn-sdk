// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Route undici's `fetch` back through the global one for the whole suite.
 *
 * `tlsFetch` detours to undici when a request needs a dispatcher — to skip
 * certificate verification, or to raise undici's 300s response-header deadline
 * (see `src/api/tls.ts`). Node's built-in `fetch` rejects a userland dispatcher
 * outright (`UND_ERR_INVALID_ARG`), so the detour is the only way to carry one.
 *
 * That detour is invisible to `vi.stubGlobal("fetch", …)`, which is how nearly
 * every test here observes requests. Without this, adding a dispatcher to a
 * call would silently take it off the stub and out to the real network — the
 * failure looks like `ENOTFOUND demo.example.com`, which reads as a broken test
 * rather than a changed transport.
 *
 * Delegating keeps one interception point. `Agent` and `FormData` stay real, so
 * the dispatcher is still constructed and its arguments remain assertable.
 */
import { vi } from "vitest";

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: (url: string | URL, init?: RequestInit) => globalThis.fetch(url, init),
  };
});
