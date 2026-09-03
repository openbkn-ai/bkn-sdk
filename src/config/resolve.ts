// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { configureVersionCheck } from "../api/version-check.js";
import { createTraceContext } from "../trace-context.js";
import type { ClientOptions, RequestContext } from "../types.js";
import { trimTrailingSlashes } from "../utils/base-url.js";
import { InputError } from "../utils/errors.js";
import { activePlatform, findUserId, readToken, usersOfPlatform, writeToken } from "./store.js";

/**
 * Resolve a full RequestContext from explicit options → env → store.
 * Order: caller options win, then env vars, then the active platform/user
 * in `~/.bkn/`.
 */

/** Resolve `--user` to a user id, or explain what is saved instead. */
function resolveUserId(baseUrl: string, userOrName: string): string {
  const id = findUserId(baseUrl, userOrName);
  if (id) return id;
  const known = usersOfPlatform(baseUrl)
    .map((u) => u.username ?? u.userId)
    .join(", ");
  throw new InputError(
    `No saved user '${userOrName}' on ${baseUrl}. Saved: ${known || "(none)"}. See \`openbkn auth users ${baseUrl}\`.`,
  );
}

export function resolveContext(opts: ClientOptions = {}): RequestContext {
  const baseUrl = opts.baseUrl ?? process.env.BKN_BASE_URL ?? activePlatform();
  if (!baseUrl) {
    throw new InputError(
      "No base URL. Pass --base-url, set BKN_BASE_URL, or run `openbkn auth login`.",
    );
  }
  const normalized = trimTrailingSlashes(baseUrl);

  const user = opts.user ?? process.env.BKN_USER;
  const stored = user
    ? readToken(normalized, resolveUserId(normalized, user))
    : readToken(normalized);
  const explicit = opts.token ?? process.env.BKN_TOKEN;
  const token = explicit ?? stored?.accessToken ?? "";
  if (!token) {
    throw new InputError("No access token. Set BKN_TOKEN or run `openbkn auth login`.");
  }

  // A `-k` login is remembered per platform so a self-signed host needn't
  // repeat it. This is safe now only because the opt-out rides a per-request
  // undici dispatcher (api/tls.ts): it skips verification for *this platform's*
  // requests, never by flipping the process-global TLS setting. So the blast
  // radius is this one self-signed host, not a library consumer's whole process.
  const insecure = opts.insecure ?? stored?.tlsInsecure ?? false;
  // Auto-refresh only for stored credentials with a refresh token (not --token/env).
  const refresh =
    !explicit && stored?.refreshToken
      ? {
          refreshToken: stored.refreshToken,
          persist: (t: { accessToken: string; refreshToken?: string; idToken?: string }) => {
            writeToken(
              normalized,
              {
                ...stored,
                accessToken: t.accessToken,
                refreshToken: t.refreshToken ?? stored.refreshToken,
                idToken: t.idToken ?? stored.idToken,
              },
              // `--user` picks an identity for this command only; a refresh
              // must not promote it to the default for the next one.
              { setActive: !user },
            );
          },
        }
      : undefined;

  const ctx: RequestContext = {
    baseUrl: normalized,
    token,
    insecure,
    ...((opts.evidenceIngestToken ?? process.env.BKN_TRACE_EVIDENCE_INGEST_TOKEN)
      ? {
          evidenceIngestToken:
            opts.evidenceIngestToken ?? process.env.BKN_TRACE_EVIDENCE_INGEST_TOKEN,
        }
      : {}),
    // Correlation ids come from `opts.trace` only. The CLI reads its flags and
    // env vars in `commands/_shared.ts`; a library client must not inherit an
    // ambient interaction id it would then freeze for its whole lifetime.
    trace: createTraceContext(opts.trace),
    ...(refresh ? { refresh } : {}),
    ...(opts.rememberedConversationId
      ? { rememberedConversationId: opts.rememberedConversationId }
      : {}),
    ...(opts.onConversationOpened ? { onConversationOpened: opts.onConversationOpened } : {}),
  };
  configureVersionCheck(ctx, opts.versionCheckMode ?? "memory");
  return ctx;
}
