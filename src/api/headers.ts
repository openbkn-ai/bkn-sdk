// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { serializeBaggage } from "../trace-context.js";
/** Build request headers with auth + business domain injected. */
import type { RequestContext } from "../types.js";

export function buildHeaders(
  ctx: RequestContext,
  extra?: Record<string, string>,
): Record<string, string> {
  const baggage = serializeBaggage(ctx.trace?.baggage);
  // Only `authorization` carries the token. A custom header would survive a
  // cross-origin redirect that strips `authorization`, handing the bearer to
  // the redirect target (the download routes follow redirects); bkn-safe
  // rejects a request that carries one anyway.
  return {
    authorization: `Bearer ${ctx.token}`,
    "x-business-domain": ctx.businessDomain,
    ...(ctx.trace
      ? {
          "bkn-request-id": ctx.trace.requestId,
          "x-request-id": ctx.trace.requestId,
          traceparent: ctx.trace.traceparent,
        }
      : {}),
    ...(baggage ? { baggage } : {}),
    ...extra,
  };
}
