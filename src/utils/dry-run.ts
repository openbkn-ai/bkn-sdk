// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * `--dry-run` — show the request a command would send, and send nothing.
 *
 * A caller assembling a body (`--args`, `--body`, an MCP tool call) otherwise
 * learns whether they got it right by watching the platform reject it. This
 * stops at the last moment before the wire and prints what would have gone out,
 * so a wrong shape costs a read instead of a round trip and a 400.
 *
 * The switch is process-wide because it belongs to one CLI invocation; the SDK
 * never turns it on.
 */

let enabled = false;
let suppressed = 0;

/** Turn on request preview for this process. */
export function enableDryRun(): void {
  enabled = true;
}

export function isDryRun(): boolean {
  return enabled;
}

/**
 * Run something without previewing it: the exchanges a caller is not asking
 * about, such as an MCP handshake, so the preview lands on the request they
 * typed. Token refresh takes the other road — it rotates a stored credential,
 * so under a dry run it does not happen at all.
 */
export async function withoutPreview<T>(fn: () => Promise<T>): Promise<T> {
  suppressed += 1;
  try {
    return await fn();
  } finally {
    suppressed -= 1;
  }
}

export interface PreviewedRequest {
  dryRun: true;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** Thrown instead of sending; the CLI entry point prints it and exits cleanly. */
export class DryRunSignal extends Error {
  readonly request: PreviewedRequest;

  constructor(request: PreviewedRequest) {
    super("dry run: request not sent");
    this.name = "DryRunSignal";
    this.request = request;
  }
}

/** Whatever shape a caller passes headers in. */
type HeaderInput = Headers | Record<string, string> | Array<[string, string]> | undefined;

/** Header values that identify the caller are replaced, never printed. */
function redact(headers: HeaderInput): Record<string, string> {
  const out: Record<string, string> = {};
  const entries =
    headers instanceof Headers
      ? [...headers.entries()]
      : Array.isArray(headers)
        ? headers
        : Object.entries(headers ?? {});
  for (const [k, v] of entries) {
    const key = String(k);
    out[key] = /authorization|cookie|token|api-key/i.test(key) ? "<redacted>" : String(v);
  }
  return out;
}

/**
 * Stop here when previewing. `body` is parsed back from JSON where possible so
 * the preview shows the structure a caller is checking, not an escaped string.
 */
export function previewRequest(input: {
  method: string;
  url: string | URL;
  headers?: HeaderInput;
  body?: unknown;
}): void {
  if (!enabled || suppressed > 0) return;
  let body = input.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      // A multipart or plain-text body stays as it is.
    }
  }
  throw new DryRunSignal({
    dryRun: true,
    method: input.method,
    url: String(input.url),
    headers: redact(input.headers),
    ...(body === undefined ? {} : { body }),
  });
}
