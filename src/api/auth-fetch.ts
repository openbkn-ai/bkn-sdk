// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Shared 401 refresh-and-retry for the direct-`fetch` escape hatches (raw
 * bytes, multipart uploads, SSE streams) that can't go through `request()`.
 *
 * The SDK request path (api/http.ts) already refreshes an expired token on a
 * 401 and retries; this gives every other authenticated fetch the same
 * self-healing so a stale (or opaque, server-expired) token doesn't surface as
 * "token is invalid".
 */
import type { RequestContext } from "../types.js";
import { refreshIfExpiring, renewAfter401 } from "./http.js";

/**
 * Run `send`, and on a 401 with stored refresh credentials, refresh the access
 * token once and run it again. A token about to expire is renewed before the
 * first send. `send` MUST rebuild its request — and therefore its
 * `Authorization` header — on each call, so the retry uses the refreshed
 * `ctx.token`. The response body is never read here, so the returned Response
 * is always safe to consume (JSON, bytes, or a stream).
 */
export async function authFetch(
  ctx: RequestContext,
  send: () => Promise<Response>,
): Promise<Response> {
  await refreshIfExpiring(ctx);
  const sentToken = ctx.token;
  let res = await send();
  if (res.status === 401 && ctx.refresh && (await renewAfter401(ctx, sentToken))) {
    res = await send();
  }
  return res;
}
