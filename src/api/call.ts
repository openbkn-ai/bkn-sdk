/**
 * Raw API passthrough — the `call`/`curl` escape hatch. Builds a request with
 * auth headers injected and returns the raw response (status + body), WITHOUT
 * throwing on non-2xx (the caller decides). Pure helpers are unit-tested.
 */
import { readFileSync } from "node:fs";
import type { RequestContext } from "../types.js";
import { buildHeaders } from "./headers.js";

export interface RawCallOptions {
  method?: string;
  /** Extra headers as raw "Name: value" strings. */
  header?: string[];
  /** Raw request body (string). Mutually exclusive with `form`. */
  data?: string;
  /** Multipart fields: "key=value" or "key=@/path/to/file". */
  form?: string[];
  /** Override business domain for this call. */
  businessDomain?: string;
  verbose?: boolean;
  timeoutMs?: number;
}

export interface RawCallResult {
  status: number;
  statusText: string;
  body: string;
}

/** Parse a single `Name: value` header string. Returns null if malformed. */
export function parseHeader(raw: string): [string, string] | null {
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  return [raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()];
}

/** Parse a `-F key=value` / `key=@file` field into [key, value, isFile]. */
export function parseFormField(raw: string): [string, string, boolean] {
  const idx = raw.indexOf("=");
  if (idx < 0) throw new Error(`Invalid form field (expected key=value): ${raw}`);
  const key = raw.slice(0, idx);
  const value = raw.slice(idx + 1);
  if (value.startsWith("@")) return [key, value.slice(1), true];
  return [key, value, false];
}

function resolveUrl(ctx: RequestContext, path: string): string {
  return path.startsWith("http") ? path : `${ctx.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
}

export async function rawCall(
  ctx: RequestContext,
  path: string,
  opts: RawCallOptions = {},
): Promise<RawCallResult> {
  const url = resolveUrl(ctx, path);
  const extra: Record<string, string> = {};
  for (const h of opts.header ?? []) {
    const parsed = parseHeader(h);
    if (parsed) extra[parsed[0].toLowerCase()] = parsed[1];
  }

  let body: string | FormData | undefined;
  if (opts.form && opts.form.length > 0) {
    const fd = new FormData();
    for (const field of opts.form) {
      const [key, value, isFile] = parseFormField(field);
      if (isFile) fd.append(key, new Blob([readFileSync(value)]), value.split("/").pop());
      else fd.append(key, value);
    }
    body = fd; // fetch sets the multipart content-type + boundary
  } else if (opts.data !== undefined) {
    body = opts.data;
    if (!extra["content-type"]) extra["content-type"] = "application/json";
  }

  const method = opts.method ?? (body !== undefined ? "POST" : "GET");
  const headers = buildHeaders(
    { ...ctx, businessDomain: opts.businessDomain ?? ctx.businessDomain },
    extra,
  );

  if (opts.verbose) process.stderr.write(`> ${method} ${url}\n`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    return { status: res.status, statusText: res.statusText, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}
