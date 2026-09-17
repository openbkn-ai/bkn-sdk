// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * TLS handling for self-signed platforms (`--insecure` / `-k`).
 *
 * The opt-out is scoped to the requests that asked for it, via an undici
 * dispatcher. It used to flip `NODE_TLS_REJECT_UNAUTHORIZED=0`, which is
 * process-wide and never restored: one `-k` disabled certificate verification
 * for every later request in the process — including, for a library consumer,
 * their own unrelated HTTPS traffic.
 *
 * Node's built-in `fetch` will not accept a dispatcher from a userland undici
 * (version skew — `UND_ERR_INVALID_ARG`), so requests go through undici's own
 * `fetch`, which does.
 */
import { Agent, FormData as UndiciFormData, fetch as undiciFetch } from "undici";
import { previewRequest } from "../utils/dry-run.js";

type UndiciInit = NonNullable<Parameters<typeof undiciFetch>[1]>;

/**
 * undici's own default deadline for response headers, measured on Node 24: a
 * request to an endpoint that sends no headers fails with
 * `UND_ERR_HEADERS_TIMEOUT` at 301s. Anything up to this needs no dispatcher.
 */
export const UNDICI_HEADERS_TIMEOUT_MS = 300_000;

/**
 * Agents are shared and cached — building one per request leaks connection
 * pools. Keyed by the two things that can vary: certificate verification, and
 * how long we will wait for response headers.
 */
const agents = new Map<string, Agent>();
function dispatcherFor(insecure: boolean, headersTimeoutMs?: number): Agent {
  const key = `${insecure}|${headersTimeoutMs ?? ""}`;
  let agent = agents.get(key);
  if (!agent) {
    agent = new Agent({
      ...(insecure ? { connect: { rejectUnauthorized: false } } : {}),
      ...(headersTimeoutMs === undefined
        ? {}
        : // undici also enforces a body deadline; a request that waits this
          // long for headers is not going to stream its body any faster.
          { headersTimeout: headersTimeoutMs, bodyTimeout: headersTimeoutMs }),
    });
    agents.set(key, agent);
  }
  return agent;
}

/**
 * Undici brand-checks a request body against *its own* `FormData` class, and
 * the callers here build multipart bodies with the platform's global one. An
 * unconverted form falls through to undici's string branch: the request goes
 * out as `text/plain` carrying the literal "[object FormData]", and every
 * upload (`bkn push`, `tool upload`, `skill register`, …) fails with "request
 * Content-Type isn't multipart/form-data". Rebuild it with undici's class.
 *
 * The reverse conversion is never needed: the global `fetch` sees only bodies
 * built with the global `FormData`.
 */
function isFormData(body: unknown): body is FormData {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { [Symbol.toStringTag]?: string })[Symbol.toStringTag] === "FormData"
  );
}

function toUndiciBody(body: RequestInit["body"]): UndiciInit["body"] {
  if (body instanceof UndiciFormData || !isFormData(body)) return body as UndiciInit["body"];
  const form = new UndiciFormData();
  for (const [name, value] of body.entries()) {
    if (typeof value === "string") form.append(name, value);
    else form.append(name, value, value.name);
  }
  return form;
}

/**
 * `fetch`, with certificate verification disabled for this call alone when
 * `insecure` is set. Use it instead of the global `fetch` for every request
 * that honours `--insecure`.
 *
 * The ordinary path stays on the platform's own `fetch`. A request detours
 * through undici when it needs a dispatcher — to skip certificate
 * verification, or to raise the deadline for response headers.
 *
 * That second reason is not theoretical: undici applies a 300s
 * `headersTimeout` by default, and an endpoint that blocks until its work is
 * done sends no headers until then. Measured on Node 24, a request to such an
 * endpoint fails with `UND_ERR_HEADERS_TIMEOUT` at 301s no matter what
 * `AbortController` deadline the caller set, so a longer client budget is not
 * enough on its own.
 */
export async function tlsFetch(
  transport: boolean | undefined | Transport,
  url: string | URL,
  init?: RequestInit,
  headersTimeoutMs?: number,
): Promise<Response> {
  const {
    insecure,
    retry = true,
    onRetry,
  } = typeof transport === "object" ? transport : { insecure: transport };
  // Every outbound request funnels through here — `request()`, the MCP fetch,
  // `call`, and the multipart uploads that build their own — so this is the one
  // place where `--dry-run` can promise it sent nothing.
  previewRequest({
    method: String(init?.method ?? "GET"),
    url,
    headers: init?.headers as Record<string, string> | undefined,
    body:
      typeof init?.body === "string" ? init.body : init?.body ? "<binary or multipart>" : undefined,
  });
  // Only detour for a header deadline that the platform's own `fetch` cannot
  // already honour. Below the threshold the two behave identically, and staying
  // on the global keeps it interceptable — a consumer who stubs `fetch` should
  // not lose that because a caller asked for a deadline it was already meeting.
  const needsAgent = headersTimeoutMs !== undefined && headersTimeoutMs > UNDICI_HEADERS_TIMEOUT_MS;
  const send = (): Promise<Response> =>
    !insecure && !needsAgent
      ? fetch(url, init)
      : (undiciFetch(url, {
          ...(init as UndiciInit | undefined),
          ...(init?.body === undefined || init?.body === null
            ? {}
            : { body: toUndiciBody(init.body) }),
          dispatcher: dispatcherFor(insecure === true, needsAgent ? headersTimeoutMs : undefined),
        }) as unknown as Promise<Response>);

  const method = String(init?.method ?? "GET").toUpperCase();
  const replayable = !(init?.body instanceof ReadableStream);
  for (let attempt = 1; ; attempt++) {
    let reason: string | undefined;
    let retryAfterMs = 0;
    try {
      const res = await send();
      if (!RETRY_STATUSES.has(res.status) || !IDEMPOTENT.has(method)) return res;
      reason = `HTTP ${res.status}`;
      retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      if (!canRetry(attempt) || retryAfterMs > RETRY_AFTER_CAP_MS) return res;
      await res.body?.cancel().catch(() => {});
    } catch (err) {
      reason = retryableCode(err, method);
      if (!reason || !canRetry(attempt)) throw err;
    }
    const delayMs = Math.max(RETRY_DELAYS_MS[attempt - 1] as number, retryAfterMs);
    onRetry?.({
      attempt,
      retries: RETRY_DELAYS_MS.length,
      delayMs,
      method,
      url: String(url),
      reason,
    });
    await sleep(delayMs, init?.signal);
  }

  function canRetry(attempt: number): boolean {
    return retry && replayable && attempt <= RETRY_DELAYS_MS.length && !init?.signal?.aborted;
  }
}

/**
 * Wait, but not past the caller's deadline: an abort ends the sleep, and the
 * next send fails at once with the caller's own AbortError. Without this a
 * 5 s preflight could spend 2 s asleep after its deadline had passed.
 */
function sleep(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Retry-After as milliseconds (delta-seconds or an HTTP date); 0 when absent or unreadable. */
function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

/** How a caller's requests travel: TLS verification, and whether to ride out a blip. */
export interface Transport {
  insecure?: boolean;
  /**
   * Retry a failure that says nothing about the request itself — default true.
   * See {@link tlsFetch} for exactly which failures qualify.
   */
  retry?: boolean;
  /** Told before each retry sleep; the CLI prints it so a stalled command says why. */
  onRetry?: (notice: RetryNotice) => void;
}

export interface RetryNotice {
  /** 1-based number of the retry about to happen. */
  attempt: number;
  retries: number;
  delayMs: number;
  method: string;
  url: string;
  /** An error code such as `ECONNREFUSED`, or `HTTP 503`. */
  reason: string;
}

/*
 * Transient-failure retry. A POC gateway that restarts several times a day
 * answers ECONNREFUSED for a few seconds each time, and every command running
 * then used to die with it. Which failures are retried depends on whether the
 * request could have reached a server:
 *
 * - the connection was never made — retry any method, nothing was received.
 *   That includes an MCP `tools/call` carrying a managed `bkn_context`: the
 *   server never saw it, so no operation or receipt can be duplicated;
 * - it dropped or timed out, or the answer was 429/502/503 — retry only
 *   GET/HEAD, since a write may already have landed upstream: neither a
 *   gateway error nor a rate limiter in front of one proves the service never
 *   ran it. A Retry-After lengthens the wait; one above 10 s is answered, not
 *   waited for.
 *
 * Not retried: ENOTFOUND (a mistyped host only fails slower), TLS errors, 504
 * (routed work that may still be running), and anything the caller aborted.
 * The caller's own deadline still bounds every attempt together.
 */
const RETRY_DELAYS_MS = [500, 1000, 2000];
const RETRY_AFTER_CAP_MS = 10_000;
const RETRY_STATUSES = new Set([429, 502, 503]);
const IDEMPOTENT = new Set(["GET", "HEAD"]);
const NOT_CONNECTED = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);
// ETIMEDOUT belongs here: Node raises it for a stalled established socket as
// well as for a connect, and the code alone cannot tell which.
const DROPPED = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CLOSED"]);

/** The error code that makes this failure worth retrying for `method`, if any. */
function retryableCode(err: unknown, method: string): string | undefined {
  for (const code of errorCodes(err)) {
    if (NOT_CONNECTED.has(code)) return code;
    if (DROPPED.has(code) && IDEMPOTENT.has(method)) return code;
  }
  return undefined;
}

/** Codes along a `fetch failed` cause chain, including happy-eyeballs AggregateErrors. */
function errorCodes(err: unknown, depth = 0): string[] {
  if (!err || typeof err !== "object" || depth > 4) return [];
  const e = err as { code?: unknown; cause?: unknown; errors?: unknown };
  return [
    ...(typeof e.code === "string" ? [e.code] : []),
    ...errorCodes(e.cause, depth + 1),
    ...(Array.isArray(e.errors) ? e.errors.flatMap((x) => errorCodes(x, depth + 1)) : []),
  ];
}
