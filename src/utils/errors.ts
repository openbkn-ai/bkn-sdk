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
 * Raised when the server refuses a call it received: an MCP tool answering with
 * `isError`, or a JSON-RPC top-level `error` from a gateway that validates
 * before dispatch. Both mean the deploy answered *about this call*, which is
 * what separates them from a transport failure — hence not an
 * {@link HttpError} — and the server's error `code` is what decides whether a
 * caller can recover, so it travels with the error.
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
    // A platform error body is an envelope, sometimes wrapping another one in a
    // string. Read it down to the sentence a caller can act on rather than
    // making every reader — human or agent — parse nested JSON.
    const detail = serverMsg ? `: ${serverMsg}` : err.body ? `: ${truncate(err.body, 500)}` : "";
    // A hint on any other status is the actionable half of the message — a bare
    // server error body tells the user what failed but never what to do next.
    const next = err.hint ? ` ${err.hint}` : "";
    return `Request failed (HTTP ${err.status} ${err.statusText})${detail}${next}`;
  }
  if (err instanceof ToolError && err.code) {
    const lifecycleMessage = lifecycleErrorMessage(err.code);
    if (lifecycleMessage) return `${err.code}: ${lifecycleMessage}`;
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

/**
 * Lifecycle services can include the original MCP query in their diagnostic
 * message. Keep the recovery path, but never echo that raw diagnostic: it can
 * contain caller-provided arguments and a serialized business context.
 */
function lifecycleErrorMessage(code: string): string | undefined {
  switch (code) {
    case "interaction_terminal":
      return "The interaction is no longer active. Start a new interaction and retry with its current ID.";
    case "interaction_required":
      return "Start an interaction before calling this managed tool.";
    case "conversation_required":
      return "Provide the conversation that owns this interaction and retry.";
    case "conversation_context_conflict":
      return "Use matching conversation and interaction IDs from the same managed context.";
    case "invalid_business_context":
      return "The deploy rejected the managed context. Refresh it from the current identity and retry.";
    default:
      return undefined;
  }
}

/** Pull a human message out of a server JSON error body, if any. */
/** The sentence inside a platform error envelope, or "" if this is not one. */
export function readableServerError(body: string): string {
  return serverError(body);
}

function serverError(body: string): string {
  if (!body) return "";
  try {
    return describeEnvelope(JSON.parse(body) as Record<string, unknown>);
  } catch {
    return "";
  }
}

/**
 * Render one platform error envelope as a sentence: the human description, the
 * stable code that identifies it, and the suggested fix when the server offers
 * one. Services nest an inner envelope inside `details` as a string, so follow
 * that one level down to the error that actually happened.
 */
function describeEnvelope(j: Record<string, unknown>, depth = 0): string {
  const text = (v: unknown): string => (typeof v === "string" && v.trim() ? v.trim() : "");
  const description = text(j.description) || text(j.error) || text(j.detail) || text(j.message);
  const code = text(j.error_code) || text(j.code);
  const solution = text(j.solution);
  const details = text(j.error_details) || text(j.details);

  const inner = depth < 2 ? innerEnvelope(details) : "";
  const parts = [
    description || code,
    description && code ? `[${code}]` : "",
    inner || (details && details !== description ? truncate(details, 200) : ""),
    solution && solution !== description ? `— ${solution}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

/** Some services embed the upstream envelope as JSON inside a prose `details`. */
function innerEnvelope(details: string, depth = 0): string {
  const start = details.indexOf("{");
  const end = details.lastIndexOf("}");
  if (start === -1 || end <= start) return "";
  try {
    const nested = JSON.parse(details.slice(start, end + 1)) as Record<string, unknown>;
    const rendered = describeEnvelope(nested, depth + 1);
    return rendered ? `(${rendered})` : "";
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
