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

  constructor(status: number, statusText: string, body: string, hint?: string) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.hint = hint;
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
  constructor(message: string) {
    super(message);
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
  if (err instanceof HttpError) {
    const serverMsg = serverError(err.body);
    if (err.status === 401) {
      const next = err.hint ?? "Run `openbkn auth login` and retry.";
      return `Not authorized (HTTP 401)${serverMsg ? `: ${serverMsg}` : ""}. ${next}`;
    }
    if (err.status === 403) {
      // Surface the server reason (e.g. "not an admin", "built-in role read-only").
      return `Forbidden (HTTP 403)${serverMsg ? `: ${serverMsg}` : " — admin privileges required"}.`;
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
