// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Thin fetch wrapper: explicit timeout, auth headers, JSON in/out, typed errors.
 * The single choke point for every backend call — resources build on this.
 */
import { refreshAccessToken } from "../auth/oauth.js";
import type { RequestContext } from "../types.js";
import { HttpError, NonJsonResponseError } from "../utils/errors.js";
import { stringifyBigIntJSON } from "../utils/json-bigint.js";
import { buildHeaders } from "./headers.js";
import { tlsFetch } from "./tls.js";

export interface RequestInitEx {
  method?: string;
  /** JSON body — serialized and Content-Type set automatically. */
  body?: unknown;
  /** Query params appended to the path. */
  query?: Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;
  headers?: Record<string, string>;
  /** Redirect policy; credential-bearing writes should use `manual`. */
  redirect?: "follow" | "error" | "manual";
  /** Per-request timeout; defaults to 30s. */
  timeoutMs?: number;
  /**
   * Raise undici's 300s response-header deadline for this request.
   *
   * Needed by any endpoint that blocks until its work finishes — it sends no
   * headers until then, so `timeoutMs` alone cannot buy more than 300s.
   */
  headersTimeoutMs?: number;
  /** Optional parser for a successful non-empty response body. */
  responseParser?: (text: string) => unknown;
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
    tlsFetch(
      ctx.insecure,
      url,
      {
        method: init.method ?? (hasBody ? "POST" : "GET"),
        headers: buildHeaders(ctx, {
          ...(hasBody ? { "content-type": "application/json" } : {}),
          ...init.headers,
        }),
        body: hasBody ? stringifyBigIntJSON(init.body) : undefined,
        redirect: init.redirect,
        signal: controller.signal,
      },
      init.headersTimeoutMs,
    );

  try {
    let res = await send();
    // On a 401 with stored credentials, refresh the access token once and retry.
    if (res.status === 401 && ctx.refresh && (await tryRefresh(ctx))) {
      res = await send();
    }
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      // Both hints can apply at once — an auth proxy answers a revoked AppKey
      // with an HTML 401 — so join them rather than letting either win.
      const gateway = gatewayHint(url, contentType, text);
      const hints = [gateway, hintFor(ctx, res.status, text)].filter(Boolean);
      throw new HttpError(
        res.status,
        res.statusText,
        text,
        hints.join(" ") || undefined,
        gateway !== undefined,
      );
    }
    if (!text) return undefined as T;
    try {
      return (init.responseParser ?? JSON.parse)(text) as T;
    } catch {
      // A 2xx can mean either "the service answered in something other than
      // JSON" or "a proxy answered instead of the service" — an SSO gateway
      // serves a 200 login page for a dead session. Carry which one it was
      // rather than flattening it into the message: callers act on it.
      const gateway = gatewayHint(url, contentType, text);
      throw new NonJsonResponseError(
        res.status,
        contentType,
        text,
        gateway ??
          `${url.pathname} answered HTTP ${res.status} with a non-JSON body (${contentType || "no content-type"}).`,
        gateway !== undefined,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Recognise a reverse-proxy error page. Every backend here speaks JSON, so an
 * HTML body means the request died at the gateway — usually the service is not
 * deployed or not routed on this cluster. Without this the caller sees a bare
 * `HTTP 404` and reads it as "this record does not exist".
 */
function gatewayHint(url: URL, contentType: string, body: string): string | undefined {
  const looksHtml =
    contentType.includes("html") || /^\s*(<!doctype html|<html)/i.test(body.slice(0, 200));
  if (!looksHtml) return undefined;
  return [
    "The response is an HTML error page, not JSON — the request did not reach the service",
    `behind ${url.pathname}. That backend is likely not deployed or not routed on this`,
    "cluster; check with your platform operator.",
  ].join(" ");
}

/**
 * Status-specific next-step guidance. An AppKey (`bak_…`) 401 means the key is
 * invalid/expired/revoked or its owner was disabled — re-issue, don't retry or
 * `auth login` (an AppKey has no login/refresh).
 */
function hintFor(ctx: RequestContext, status: number, body: string): string | undefined {
  if (status === 401 && ctx.token.startsWith("bak_")) {
    return "AppKey invalid / expired / revoked / owner disabled — re-issue with `openbkn appkey create` (or `appkey regenerate <id>`). Do not auto-retry.";
  }
  return lifecycleHint(body);
}

const LIFECYCLE_ACTIONS = new Set([
  "create_conversation",
  "start_interaction",
  "ensure_operation",
  "bkn_start_interaction",
]);

/**
 * Next-step guidance when a deploy rejects a request for want of a managed
 * lifecycle session. The SDK's own callers open one automatically, so reaching
 * this means a hand-rolled request body — say what it lacks and where to get it.
 * Returns `undefined` for every other error, so callers can pass any body in.
 *
 * The handshake differs by deploy and `required_action` does not distinguish
 * them — a deploy needing only `bkn_start_interaction` still answers
 * `create_conversation` — so the text sends the reader to the tool catalog
 * rather than naming one of the two shapes and being wrong half the time.
 */
export function lifecycleHint(body: string): string | undefined {
  if (!LIFECYCLE_ACTIONS.has(requiredAction(body) ?? "")) return undefined;
  return (
    "This deploy requires a managed lifecycle session: the request needs a `bkn_context` " +
    "with conversation_id and interaction_id. Easiest fix: use the `openbkn bkn` / `openbkn " +
    "context` commands, which open and release one for you. To do it by hand, check " +
    "`openbkn context info` for the deploy's lifecycle tools — where it lists " +
    "`bkn_create_conversation`, call that first and pass the conversation_id it returns to " +
    "`bkn_start_interaction`; where it does not, `bkn_start_interaction` alone returns both ids. " +
    "Either way: `openbkn context tool-call <kn-id> <tool> --args '{...}'`."
  );
}

function requiredAction(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { required_action?: unknown } };
    const action = parsed.error?.required_action;
    return typeof action === "string" ? action : undefined;
  } catch {
    return undefined;
  }
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
