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
export function tlsFetch(
  insecure: boolean | undefined,
  url: string | URL,
  init?: RequestInit,
  headersTimeoutMs?: number,
): Promise<Response> {
  // Only detour for a header deadline that the platform's own `fetch` cannot
  // already honour. Below the threshold the two behave identically, and staying
  // on the global keeps it interceptable — a consumer who stubs `fetch` should
  // not lose that because a caller asked for a deadline it was already meeting.
  const needsAgent = headersTimeoutMs !== undefined && headersTimeoutMs > UNDICI_HEADERS_TIMEOUT_MS;
  if (!insecure && !needsAgent) return fetch(url, init);
  return undiciFetch(url, {
    ...(init as UndiciInit | undefined),
    ...(init?.body === undefined || init?.body === null ? {} : { body: toUndiciBody(init.body) }),
    dispatcher: dispatcherFor(insecure === true, needsAgent ? headersTimeoutMs : undefined),
  }) as unknown as Promise<Response>;
}
