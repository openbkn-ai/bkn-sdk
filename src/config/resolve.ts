/**
 * Resolve a full RequestContext from explicit options → env → store.
 * Order: caller options win, then env vars, then the active platform/user
 * in `~/.bkn/`.
 */
import { type ClientOptions, DEFAULT_BUSINESS_DOMAIN, type RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import { activePlatform, readPlatformConfig, readToken, writeToken } from "./store.js";

export function resolveContext(opts: ClientOptions = {}): RequestContext {
  const baseUrl = opts.baseUrl ?? process.env.BKN_BASE_URL ?? activePlatform();
  if (!baseUrl) {
    throw new InputError(
      "No base URL. Pass --base-url, set BKN_BASE_URL, or run `openbkn auth login`.",
    );
  }
  const normalized = baseUrl.replace(/\/+$/, "");

  const stored = readToken(normalized);
  const explicit = opts.token ?? process.env.BKN_TOKEN;
  const token = explicit ?? stored?.accessToken;
  if (!token) {
    throw new InputError("No access token. Set BKN_TOKEN or run `openbkn auth login`.");
  }

  const insecure = opts.insecure ?? stored?.tlsInsecure ?? false;
  // Auto-refresh only for stored credentials with a refresh token (not --token/env).
  const refresh =
    !explicit && stored?.refreshToken
      ? {
          refreshToken: stored.refreshToken,
          persist: (t: { accessToken: string; refreshToken?: string; idToken?: string }) => {
            writeToken(normalized, {
              ...stored,
              accessToken: t.accessToken,
              refreshToken: t.refreshToken ?? stored.refreshToken,
              idToken: t.idToken ?? stored.idToken,
            });
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
