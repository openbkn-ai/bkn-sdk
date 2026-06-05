/** Typed errors and their mapping to user-facing messages + exit codes. */

/** Raised when an HTTP request returns a non-2xx status. */
export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
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
    if (err.status === 401 || err.status === 403) {
      return `Not authorized (HTTP ${err.status}). Run \`openbkn auth login\` and retry.`;
    }
    const detail = err.body ? `: ${truncate(err.body, 500)}` : "";
    return `Request failed (HTTP ${err.status} ${err.statusText})${detail}`;
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
