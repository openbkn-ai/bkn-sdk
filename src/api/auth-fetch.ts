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
import { tryRefresh } from "./http.js";
import { isRead, withRetry } from "./retry.js";

/**
 * Run `send`, and on a 401 with stored refresh credentials, refresh the access
 * token once and run it again. `send` MUST rebuild its request — and therefore
 * its `Authorization` header — on each call, so the retry uses the refreshed
 * `ctx.token`. The response body is never read here, so the returned Response
 * is always safe to consume (JSON, bytes, or a stream).
 *
 * A transient failure is retried when the request only reads (see
 * `api/retry.ts`): a GET `method`, or `read: true`. Left out, the request is
 * taken for a write and sent once.
 */
export async function authFetch(
  ctx: RequestContext,
  send: () => Promise<Response>,
  opts: { method?: string; url?: string | URL; read?: boolean; deadline?: number } = {},
): Promise<Response> {
  const method = opts.method ?? "POST";
  const attempt = () =>
    withRetry(
      ctx,
      {
        method,
        url: opts.url ?? "",
        read: isRead(method, undefined, opts.read),
        deadline: opts.deadline,
      },
      send,
    );
  let res = await attempt();
  if (res.status === 401 && ctx.refresh && (await tryRefresh(ctx))) {
    res = await attempt();
  }
  return res;
}
