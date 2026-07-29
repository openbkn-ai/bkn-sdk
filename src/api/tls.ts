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

// One shared agent — building an Agent per request leaks connection pools.
let insecureAgent: Agent | undefined;
function insecureDispatcher(): Agent {
  insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } });
  return insecureAgent;
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
 * The ordinary path stays on the platform's own `fetch`; only an insecure
 * request detours through undici, since that is the only reason to carry a
 * dispatcher at all.
 */
export function tlsFetch(
  insecure: boolean | undefined,
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!insecure) return fetch(url, init);
  return undiciFetch(url, {
    ...(init as UndiciInit | undefined),
    ...(init?.body === undefined || init?.body === null ? {} : { body: toUndiciBody(init.body) }),
    dispatcher: insecureDispatcher(),
  }) as unknown as Promise<Response>;
}
