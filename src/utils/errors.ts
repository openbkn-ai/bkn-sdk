// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Typed errors and their mapping to user-facing messages + exit codes. */

/** Raised when an HTTP request returns a non-2xx status. */
export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;
  /** Optional next-step guidance, overriding the status default (e.g. AppKey re-issue). */
  readonly hint?: string;
  /**
   * The response was a proxy error page, so the status describes the gateway,
   * not the service. Callers that special-case a status — a 404 read as "no
   * such record" — must not do so when this is set: nothing behind the route
   * ever saw the request.
   *
   * Only `request()` sets it. The handful of sites that construct this error
   * around a raw `fetch` (streaming chat, uploads, MCP transports) leave it
   * `false`, so a false value means "not detected", never "definitely not a
   * gateway" — treat it as a positive signal only.
   */
  readonly gateway: boolean;

  constructor(status: number, statusText: string, body: string, hint?: string, gateway = false) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.hint = hint;
    this.gateway = gateway;
  }
}

/**
 * Raised when a response body is not the JSON the API contract promises.
 *
 * Usually a gateway/proxy page — the request never reached the service — but
 * not always: a service may answer a DELETE with `200 text/plain "OK"`. Which
 * one it was decides whether the status describes anything the service did, so
 * read {@link NonJsonResponseError.gateway} before acting on it.
 */
export class NonJsonResponseError extends Error {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  /**
   * The body is a proxy error page, so the request never reached the service.
   * The complement is a service that answered in something other than JSON —
   * `200 text/plain "OK"` to a DELETE, say — where the status still describes
   * what the service did. Callers reading a 2xx as "it worked" must check this
   * first: an SSO proxy answers a dead session with a `200` login page.
   *
   * Set by `request()`, the only place with the response in hand; see
   * {@link HttpError.gateway} for why `false` means "not detected".
   */
  readonly gateway: boolean;

  constructor(status: number, contentType: string, body: string, message: string, gateway = false) {
    super(message);
    this.name = "NonJsonResponseError";
    this.status = status;
    this.contentType = contentType;
    this.body = body;
    this.gateway = gateway;
  }
}

/**
 * Raised when an MCP tool answers with `isError`. The transport call succeeded,
 * so this is not an {@link HttpError} — but the server's error `code` is what
 * decides whether a caller can recover, so it travels with the error.
 */
export class ToolError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ToolError";
    if (code) this.code = code;
  }
}

/** Raised for bad CLI/SDK input before any request is made. */
export class InputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InputError";
  }
}

/** Map an error to a process exit code. */
export function toExitCode(err: unknown): number {
  if (err instanceof InputError) return 2;
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return 3; // auth
    return 1;
  }
  return 1;
}

/** A short, actionable message for the user. Never leak tokens. */
export function formatError(err: unknown): string {
  if (err instanceof NonJsonResponseError) {
    return `${err.message} Body: ${truncate(err.body.replace(/\s+/g, " ").trim(), 200)}`;
  }
  if (err instanceof HttpError) {
    const serverMsg = serverError(err.body);
    if (err.status === 401) {
      const next = err.hint ?? "Run `openbkn auth login` and retry.";
      return `Not authorized (HTTP 401)${serverMsg ? `: ${serverMsg}` : ""}. ${next}`;
    }
    if (err.status === 403) {
      // Surface the server reason (e.g. "not an admin", "built-in role read-only")
      // — plus any hint, or an HTML 403 from a proxy reads as "you lack rights"
      // when the truth is that the route never reached a service at all.
      const next = err.hint ? ` ${err.hint}` : "";
      return `Forbidden (HTTP 403)${serverMsg ? `: ${serverMsg}` : " — admin privileges required"}.${next}`;
    }
    const detail = err.body ? `: ${truncate(err.body, 500)}` : "";
    // A hint on any other status is the actionable half of the message — a bare
    // server error body tells the user what failed but never what to do next.
    const next = err.hint ? ` ${err.hint}` : "";
    return `Request failed (HTTP ${err.status} ${err.statusText})${detail}${next}`;
  }
  if (err instanceof Error) {
    // `fetch` throws a terse "fetch failed"; the real reason is on `.cause`.
    const cause = (err as { cause?: unknown }).cause as
      | { code?: string; message?: string }
      | undefined;
    if (cause?.code && isTlsCertError(cause.code)) {
      return `TLS certificate rejected (${cause.code}). The platform is likely self-signed — retry with \`-k\`/\`--insecure\`.`;
    }
    if (err.message === "fetch failed" && cause?.message) {
      return `Request failed: ${cause.message}${cause.code ? ` (${cause.code})` : ""}`;
    }
    return err.message;
  }
  return String(err);
}

/** Pull a human message out of a server JSON error body, if any. */
function serverError(body: string): string {
  if (!body) return "";
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const m = j.error ?? j.detail ?? j.description ?? j.message;
    return typeof m === "string" ? m : "";
  } catch {
    return "";
  }
}

function isTlsCertError(code: string): boolean {
  return (
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "CERT_HAS_EXPIRED" ||
    code.includes("CERT")
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
