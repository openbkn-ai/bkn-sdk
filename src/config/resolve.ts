// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Resolve a full RequestContext from explicit options → env → store.
 * Order: caller options win, then env vars, then the active platform/user
 * in `~/.bkn/`.
 */
import { type ClientOptions, DEFAULT_BUSINESS_DOMAIN, type RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import {
  activePlatform,
  findUserId,
  readPlatformConfig,
  readToken,
  usersOfPlatform,
  writeToken,
} from "./store.js";

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
  const normalized = baseUrl.replace(/\/+$/, "");

  const user = opts.user ?? process.env.BKN_USER;
  const stored = user
    ? readToken(normalized, resolveUserId(normalized, user))
    : readToken(normalized);
  const explicit = opts.token ?? process.env.BKN_TOKEN;
  const token = explicit ?? stored?.accessToken ?? "";
  if (!token) {
    throw new InputError("No access token. Set BKN_TOKEN or run `openbkn auth login`.");
  }

  // Skipping certificate verification is asked for per invocation, never
  // inherited: a stored flag would silently keep TLS off for every later call
  // — and for a library consumer, one they never made.
  const insecure = opts.insecure ?? false;
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

  return {
    baseUrl: normalized,
    token,
    businessDomain:
      opts.businessDomain ??
      readPlatformConfig(normalized).businessDomain ??
      DEFAULT_BUSINESS_DOMAIN,
    insecure,
    ...(refresh ? { refresh } : {}),
  };
}
