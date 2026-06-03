/**
 * Thin fetch wrapper: explicit timeout, auth headers, JSON in/out, typed errors.
 * The single choke point for every backend call — resources build on this.
 */
import type { RequestContext } from "../types.js";
import { HttpError } from "../utils/errors.js";
import { buildHeaders } from "./headers.js";

export interface RequestInitEx {
  method?: string;
  /** JSON body — serialized and Content-Type set automatically. */
  body?: unknown;
  /** Query params appended to the path. */
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Per-request timeout; defaults to 30s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function request<T = unknown>(
  ctx: RequestContext,
  path: string,
  init: RequestInitEx = {},
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${ctx.baseUrl}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const hasBody = init.body !== undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: init.method ?? (hasBody ? "POST" : "GET"),
      headers: buildHeaders(ctx, {
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...init.headers,
      }),
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, res.statusText, text);
    return (text ? JSON.parse(text) : undefined) as T;
  } finally {
    clearTimeout(timer);
  }
}
