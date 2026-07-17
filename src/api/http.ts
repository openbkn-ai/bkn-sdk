// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Thin fetch wrapper: explicit timeout, auth headers, JSON in/out, typed errors.
 * The single choke point for every backend call — resources build on this.
 */
import { refreshAccessToken } from "../auth/oauth.js";
import type { RequestContext } from "../types.js";
import { HttpError } from "../utils/errors.js";
import { buildHeaders } from "./headers.js";
import { tlsFetch } from "./tls.js";

export interface RequestInitEx {
  method?: string;
  /** JSON body — serialized and Content-Type set automatically. */
  body?: unknown;
  /** Query params appended to the path. */
  query?: Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;
  headers?: Record<string, string>;
  /** Per-request timeout; defaults to 30s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function request<T = unknown>(
  ctx: RequestContext,
  path: string,
  init: RequestInitEx = {},
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${ctx.baseUrl}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, String(item));
    } else if (v !== undefined) {
      url.searchParams.set(k, String(v));
    }
  }

  const hasBody = init.body !== undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const send = () =>
    tlsFetch(ctx.insecure, url, {
      method: init.method ?? (hasBody ? "POST" : "GET"),
      headers: buildHeaders(ctx, {
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...init.headers,
      }),
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

  try {
    let res = await send();
    // On a 401 with stored credentials, refresh the access token once and retry.
    if (res.status === 401 && ctx.refresh && (await tryRefresh(ctx))) {
      res = await send();
    }
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, res.statusText, text, hintFor(ctx, res.status));
    return (text ? JSON.parse(text) : undefined) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Status-specific next-step guidance. An AppKey (`bak_…`) 401 means the key is
 * invalid/expired/revoked or its owner was disabled — re-issue, don't retry or
 * `auth login` (an AppKey has no login/refresh).
 */
function hintFor(ctx: RequestContext, status: number): string | undefined {
  if (status === 401 && ctx.token.startsWith("bak_")) {
    return "AppKey invalid / expired / revoked / owner disabled — re-issue with `openbkn appkey create` (or `appkey regenerate <id>`). Do not auto-retry.";
  }
  return undefined;
}

/** Refresh ctx.token from its refresh token, persist, and report success. */
export async function tryRefresh(ctx: RequestContext): Promise<boolean> {
  if (!ctx.refresh) return false;
  try {
    const t = await refreshAccessToken(
      ctx.baseUrl,
      ctx.refresh.refreshToken,
      ctx.refresh.clientId,
      ctx.insecure,
    );
    ctx.token = t.accessToken;
    if (t.refreshToken) ctx.refresh.refreshToken = t.refreshToken;
    ctx.refresh.persist(t);
    return true;
  } catch {
    return false; // surface the original 401
  }
}
