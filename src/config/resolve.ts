/**
 * Resolve a full RequestContext from explicit options → env → config store.
 * Order: caller options win, then env vars, then `~/.bkn/`.
 */
import { type ClientOptions, DEFAULT_BUSINESS_DOMAIN, type RequestContext } from "../types.js";
import { InputError } from "../utils/errors.js";
import { readConfig, readToken } from "./store.js";

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function resolveContext(opts: ClientOptions = {}): RequestContext {
  const config = readConfig();
  const baseUrl = opts.baseUrl ?? process.env.BKN_BASE_URL ?? config.baseUrl;
  if (!baseUrl) {
    throw new InputError(
      "No base URL. Pass --base-url, set BKN_BASE_URL, or run `openbkn auth login`.",
    );
  }

  const stored = readToken(hostOf(baseUrl));
  const token = opts.token ?? process.env.BKN_TOKEN ?? stored?.accessToken;
  if (!token) {
    throw new InputError("No access token. Set BKN_TOKEN or run `openbkn auth login`.");
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    businessDomain: opts.businessDomain ?? config.businessDomain ?? DEFAULT_BUSINESS_DOMAIN,
    insecure: opts.insecure ?? stored?.insecure ?? false,
  };
}
