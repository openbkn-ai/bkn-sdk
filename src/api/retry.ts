// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Retry a read through a transient failure — a gateway restarting, a backend
 * briefly unavailable, a rate limit — with exponential backoff.
 *
 * Reads only, as docs/RELIABILITY.md requires: a write (create / update /
 * delete, an import, a build, an action or tool run, a chat turn) is never
 * resent, whatever failed — its error is surfaced for the caller to decide.
 * A read is a GET / HEAD / OPTIONS, a POST carrying `X-HTTP-Method-Override:
 * GET` (the platform's own mark for a query too large for a URL), or a request
 * its caller declares `idempotent` — a search, a query, a dry-run.
 *
 * For a read, these are retried: a connection refused, reset or timed out; DNS
 * `EAI_AGAIN`; HTTP 429, 502, 503, 504. Everything else — another 4xx or 5xx,
 * a timeout the caller set, a dry-run preview — returns or throws at once.
 */
import type { RequestContext, RetryNotice, RetryPolicy } from "../types.js";

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  retries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const TRANSIENT_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);

const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);

/**
 * Whether a request only reads: by method, by the platform's method-override
 * header, or by its caller's word.
 */
export function isRead(
  method: string,
  headers?: Record<string, string>,
  declared?: boolean,
): boolean {
  if (declared !== undefined) return declared;
  if (READ_METHODS.has(method.toUpperCase())) return true;
  const override = Object.entries(headers ?? {}).find(
    ([k]) => k.toLowerCase() === "x-http-method-override",
  )?.[1];
  return override?.toUpperCase() === "GET";
}

/** The system error code behind a failed `fetch` ("fetch failed" carries it on `.cause`). */
export function networkErrorCode(err: unknown): string | undefined {
  const e = err as {
    code?: unknown;
    cause?: { code?: unknown; errors?: Array<{ code?: unknown }> };
  };
  // A refused dual-stack connect surfaces as an AggregateError of per-address errors.
  const code = e?.cause?.code ?? e?.cause?.errors?.[0]?.code ?? e?.code;
  return typeof code === "string" ? code : undefined;
}

/** `Retry-After` as delta-seconds or an HTTP date, in ms; `undefined` when absent or unreadable. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** `base · 2^(n-1)`, ±20% jitter so clients that failed together do not return together. */
function backoffMs(policy: RetryPolicy, retry: number): number {
  return policy.baseDelayMs * 2 ** (retry - 1) * (0.8 + Math.random() * 0.4);
}

export function retryPolicyOf(ctx: RequestContext): RetryPolicy | undefined {
  if (ctx.retry === false) return undefined;
  return { ...DEFAULT_RETRY_POLICY, ...ctx.retry };
}

export interface RetryTarget {
  method: string;
  url: string | URL;
  /** Whether resending is safe — see {@link isRead}. Anything else is sent once. */
  read: boolean;
  /** Epoch ms: give up rather than sleep past it — the caller's own timeout would cut the next try short. */
  deadline?: number;
}

/**
 * Run `send`, and again after a backoff while a read fails transiently. `send`
 * must build a fresh request each call.
 */
export async function withRetry(
  ctx: RequestContext,
  target: RetryTarget,
  send: () => Promise<Response>,
): Promise<Response> {
  const policy = retryPolicyOf(ctx);
  if (!target.read || !policy || policy.retries <= 0) return send();

  for (let retry = 1; ; retry += 1) {
    let res: Response | undefined;
    let failure: unknown;
    let reason: string | undefined;
    let waitMs: number | undefined;
    try {
      res = await send();
      if (!TRANSIENT_STATUS.has(res.status)) return res;
      reason = `HTTP ${res.status}`;
      waitMs = retryAfterMs(res.headers.get("retry-after"));
    } catch (err) {
      const code = networkErrorCode(err);
      if (!code || !TRANSIENT_CODES.has(code)) throw err;
      reason = code;
      failure = err;
    }

    const delayMs = Math.min(policy.maxDelayMs, waitMs ?? backoffMs(policy, retry));
    const outOfTime = target.deadline !== undefined && Date.now() + delayMs >= target.deadline;
    if (retry > policy.retries || outOfTime) {
      if (res) return res;
      throw failure;
    }
    // Release the connection a discarded response still holds. Not awaited: a
    // cloned body's cancel settles only once every branch is cancelled.
    res?.body?.cancel().catch(() => {});
    const notice: RetryNotice = {
      method: target.method.toUpperCase(),
      url: String(target.url),
      reason,
      retry,
      retries: policy.retries,
      delayMs,
    };
    ctx.onRetry?.(notice);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
