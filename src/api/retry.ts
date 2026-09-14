// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Retry an outbound request through a transient failure — a gateway restarting,
 * a backend briefly unavailable, a rate limit — with exponential backoff.
 *
 * Only failures that say "try again" are retried, and only where resending is
 * safe:
 *
 * - The connection was refused or never resolved, so no byte of the request
 *   reached anyone: every method.
 * - HTTP 503 / 429: the server declined to act on it: every method.
 * - The connection dropped mid-exchange, or a gateway answered 502 / 504: the
 *   backend may already have acted, so only methods that are safe to repeat
 *   (GET, HEAD, OPTIONS, PUT, DELETE). A POST here is often a write — an import,
 *   an action run — and doing it twice is worse than reporting it once.
 *
 * Everything else — a 4xx, a 500, a timeout the caller set, a dry-run preview —
 * is returned or thrown on the first attempt, unchanged.
 */
import type { RequestContext, RetryNotice, RetryPolicy } from "../types.js";

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  retries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

/** Failed before the request was sent. */
const NOT_SENT = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Failed after the request may have reached the server. */
const DROPPED = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CLOSED"]);

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

function retryableError(err: unknown, idempotent: boolean): string | undefined {
  const code = networkErrorCode(err);
  if (!code) return undefined;
  return NOT_SENT.has(code) || (idempotent && DROPPED.has(code)) ? code : undefined;
}

function retryableStatus(status: number, idempotent: boolean): boolean {
  if (status === 503 || status === 429) return true;
  return idempotent && (status === 502 || status === 504);
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

/**
 * Run `send`, and again after a backoff while it fails transiently. `send` must
 * build a fresh request each call. Gives up early rather than sleep past
 * `deadline` (epoch ms) — the caller's own timeout would cut the next try short.
 */
export async function withRetry(
  ctx: RequestContext,
  method: string,
  url: string | URL,
  send: () => Promise<Response>,
  opts: { deadline?: number } = {},
): Promise<Response> {
  const policy = retryPolicyOf(ctx);
  if (!policy || policy.retries <= 0) return send();
  const idempotent = IDEMPOTENT.has(method.toUpperCase());

  for (let retry = 1; ; retry += 1) {
    let res: Response | undefined;
    let failure: unknown;
    let reason: string | undefined;
    let waitMs: number | undefined;
    try {
      res = await send();
      if (!retryableStatus(res.status, idempotent)) return res;
      reason = `HTTP ${res.status}`;
      waitMs = retryAfterMs(res.headers.get("retry-after"));
    } catch (err) {
      reason = retryableError(err, idempotent);
      if (!reason) throw err;
      failure = err;
    }

    const delayMs = Math.min(policy.maxDelayMs, waitMs ?? backoffMs(policy, retry));
    const outOfTime = opts.deadline !== undefined && Date.now() + delayMs >= opts.deadline;
    if (retry > policy.retries || outOfTime) {
      if (res) return res;
      throw failure;
    }
    // Release the connection a discarded response still holds. Not awaited: a
    // cloned body's cancel settles only once every branch is cancelled.
    res?.body?.cancel().catch(() => {});
    const notice: RetryNotice = {
      method: method.toUpperCase(),
      url: String(url),
      reason,
      retry,
      retries: policy.retries,
      delayMs,
    };
    ctx.onRetry?.(notice);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
