// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Thin fetch wrapper: explicit timeout, auth headers, JSON in/out, typed errors.
 * The single choke point for every backend call — resources build on this.
 */
import { tokenExpiresAtMs } from "../auth/jwt.js";
import { refreshAccessToken } from "../auth/oauth.js";
import type { RequestContext } from "../types.js";
import { baseUrlForDisplay } from "../utils/base-url.js";
import { isDryRun } from "../utils/dry-run.js";
import { HttpError, NonJsonResponseError } from "../utils/errors.js";
import { stringifyBigIntJSON } from "../utils/json-bigint.js";
import { buildHeaders } from "./headers.js";
import { tlsFetch } from "./tls.js";
import { ensureCompatible } from "./version-check.js";

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

  await ensureCompatible(ctx, url);

  const hasBody = init.body !== undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const method = init.method ?? (hasBody ? "POST" : "GET");
  // Headers are rebuilt per send: a refresh between the first send and the
  // retry replaces `ctx.token`, and the retry must carry the new one.
  const send = () =>
    tlsFetch(
      ctx,
      url,
      {
        method,
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
    await refreshIfExpiring(ctx);
    const sentToken = ctx.token;
    let res = await send();
    let renewal: Renewal = ctx.refresh ? "not-needed" : "unavailable";
    // On a 401 with stored credentials, refresh the access token once and retry.
    if (res.status === 401 && ctx.refresh) {
      renewal = (await renewAfter401(ctx, sentToken)) ? "renewed" : "failed";
      if (renewal === "renewed") res = await send();
    }
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      // Both hints can apply at once — an auth proxy answers a revoked AppKey
      // with an HTML 401 — so join them rather than letting either win.
      const gateway = gatewayHint(url, res.status, contentType, text);
      const hints = [gateway, hintFor(ctx, res.status, text, renewal)].filter(Boolean);
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
      const gateway = gatewayHint(url, res.status, contentType, text);
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
 * HTML body means the gateway answered instead of the service. Without this the
 * caller sees a bare `HTTP 404` and reads it as "this record does not exist".
 *
 * Which gateway failure it was matters: a 504 comes from a service that is
 * routed and simply took too long — a sandbox function that blocks on an
 * unreachable address produces one — and telling that caller their backend is
 * missing sends them to debug the wrong thing.
 */
function gatewayHint(
  url: URL,
  status: number,
  contentType: string,
  body: string,
): string | undefined {
  const looksHtml =
    contentType.includes("html") || /^\s*(<!doctype html|<html)/i.test(body.slice(0, 200));
  if (!looksHtml) return undefined;
  if (status === 504 || status === 408) {
    return [
      "The gateway timed out waiting for the service behind",
      `${url.pathname} — it is routed, it did not answer in time. Long-running work`,
      "(a sandbox run, a build) may still be going; retry the read rather than the write.",
    ].join(" ");
  }
  return [
    "The response is an HTML error page, not JSON — the request did not reach the service",
    `behind ${url.pathname}. That backend is likely not deployed or not routed on this`,
    "cluster; check with your platform operator.",
  ].join(" ");
}

/** What became of the access token on the way to this response. */
type Renewal = "unavailable" | "not-needed" | "renewed" | "failed";

const APPKEY_TIP =
  "For unattended or long-running scripts, issue a long-lived AppKey with `openbkn appkey create` and pass it as `--token bak_…`.";

/**
 * Status-specific next-step guidance. An AppKey (`bak_…`) 401 means the key is
 * invalid/expired/revoked or its owner was disabled — re-issue, don't retry or
 * `auth login` (an AppKey has no login/refresh).
 *
 * Any other 401 says which of the three things happened to the token, because
 * a bare 401 reads as "the platform is down" and the fix differs per case.
 */
function hintFor(
  ctx: RequestContext,
  status: number,
  body: string,
  renewal: Renewal,
): string | undefined {
  const displayBaseUrl = baseUrlForDisplay(ctx.baseUrl);
  const envHint =
    status === 401 && ctx.tokenFromEnv
      ? "The token came from the BKN_TOKEN environment variable, which overrides any `openbkn auth login` session — `unset BKN_TOKEN` to use the login instead."
      : undefined;
  const withEnv = (hint?: string): string | undefined =>
    [envHint, hint].filter(Boolean).join(" ") || undefined;
  if (status === 401 && ctx.token.startsWith("bak_")) {
    return withEnv(
      "AppKey invalid / expired / revoked / owner disabled — re-issue with `openbkn appkey create` (or `appkey regenerate <id>`). Do not auto-retry.",
    );
  }
  if (status === 401) {
    switch (renewal) {
      case "failed":
        return withEnv(
          `The access token expired and could not be renewed: the refresh token was rejected (expired or revoked). Run \`openbkn auth login ${displayBaseUrl}\` again. ${APPKEY_TIP}`,
        );
      case "renewed":
        return withEnv(
          `The access token was renewed, and the platform still rejects it — the session was revoked or the account disabled. Run \`openbkn auth login ${displayBaseUrl}\` again.`,
        );
      case "unavailable":
        return withEnv(
          `The token is expired or invalid, and no refresh token is saved for it (a \`--token\` / BKN_TOKEN value is never renewed). Run \`openbkn auth login ${displayBaseUrl}\`. ${APPKEY_TIP}`,
        );
      default:
        break;
    }
  }
  return withEnv(lifecycleHint(body));
}

const LIFECYCLE_ACTIONS = new Set(["start_interaction", "bkn_start_interaction"]);

/**
 * Next-step guidance when a deploy rejects a request for want of a managed
 * lifecycle session. The SDK's own callers open one automatically, so reaching
 * this means a hand-rolled request body — say what it lacks and where to get it.
 * Returns `undefined` for every other error, so callers can pass any body in.
 *
 * The contract (context-loader `mcp.yaml`) has one handshake:
 * `bkn_start_interaction` returns both ids.
 */
export function lifecycleHint(body: string): string | undefined {
  if (!LIFECYCLE_ACTIONS.has(requiredAction(body) ?? "")) return undefined;
  return (
    "This deploy requires a managed lifecycle session: the request needs a `bkn_context` " +
    "with conversation_id and interaction_id. Easiest fix: use the `openbkn bkn` / `openbkn " +
    "context` commands, which open and release one for you. To do it by hand, call " +
    "`bkn_start_interaction` (question, agent_name, conversation_mode) — it returns both ids: " +
    "`openbkn context tool-call <kn-id> bkn_start_interaction --args '{...}'`."
  );
}

function requiredAction(body: string): string | undefined {
  try {
    // Nested under `error` on older deploys; top-level on `ErrorCompact` /
    // Core `lifecycleError` bodies.
    const parsed = JSON.parse(body) as {
      required_action?: unknown;
      error?: { required_action?: unknown };
    };
    const action = parsed.error?.required_action ?? parsed.required_action;
    return typeof action === "string" ? action : undefined;
  } catch {
    return undefined;
  }
}

/**
 * In-flight refresh per context. The platform rotates refresh tokens, so two
 * concurrent requests refreshing with the same one would have the second
 * rejected — and a replayed refresh token can revoke the whole session.
 */
const refreshing = new WeakMap<RequestContext, Promise<boolean>>();

/** Refresh ctx.token from its refresh token, persist, and report success. */
export function tryRefresh(ctx: RequestContext): Promise<boolean> {
  if (!ctx.refresh) return Promise.resolve(false);
  const pending = refreshing.get(ctx);
  if (pending) return pending;
  const run = refreshOnce(ctx).finally(() => refreshing.delete(ctx));
  refreshing.set(ctx, run);
  return run;
}

async function refreshOnce(ctx: RequestContext): Promise<boolean> {
  const refresh = ctx.refresh;
  if (!refresh) return false;
  try {
    const t = await refreshAccessToken(
      ctx.baseUrl,
      refresh.refreshToken,
      refresh.clientId,
      ctx.insecure,
    );
    ctx.token = t.accessToken;
    if (t.refreshToken) refresh.refreshToken = t.refreshToken;
    refresh.expiresAt = t.expiresAt;
    refresh.persist(t);
    return true;
  } catch {
    return false; // surface the original 401
  }
}

/**
 * Renew after a 401 on a request sent with `sentToken`. When another request
 * already replaced the token meanwhile, the retry just needs the new one.
 */
export function renewAfter401(ctx: RequestContext, sentToken: string): Promise<boolean> {
  if (ctx.token !== sentToken) return Promise.resolve(true);
  return tryRefresh(ctx);
}

/** Renew this long before expiry, so a token cannot lapse between check and use. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Renew a stored-credential token that is expired or about to be, before the
 * request rather than after its 401 — the 401 path costs a failed round-trip
 * and cannot help a request whose body is a one-shot stream.
 *
 * A failed renewal is not an error here: the request goes out with the token
 * it has, and a 401 then says what to do. Skipped under `--dry-run`, which
 * promises to leave the stored credential alone.
 */
export async function refreshIfExpiring(ctx: RequestContext): Promise<void> {
  if (!ctx.refresh || isDryRun()) return;
  const expiresAt = tokenExpiresAtMs(ctx.token, ctx.refresh.expiresAt);
  if (expiresAt === undefined || expiresAt - Date.now() > EXPIRY_SKEW_MS) return;
  await tryRefresh(ctx);
}
