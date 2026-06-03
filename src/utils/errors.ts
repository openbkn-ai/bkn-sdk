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
  if (err instanceof Error) return err.message;
  return String(err);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
