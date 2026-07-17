// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Build request headers with auth + business domain injected. */
import type { RequestContext } from "../types.js";

export function buildHeaders(
  ctx: RequestContext,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    // No token = a no-auth platform (no bkn-safe); send no Authorization.
    ...(ctx.token ? { authorization: `Bearer ${ctx.token}`, token: ctx.token } : {}),
    "x-business-domain": ctx.businessDomain,
    ...extra,
  };
}
