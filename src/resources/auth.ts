/**
 * Auth resource — credential store + identity. Store-backed operations are
 * fully implemented; interactive browser/password OAuth is staged (needs a
 * verified backend contract) and lives in `auth/oauth.ts`.
 */
import { type JwtClaims, decodeJwt, isExpired } from "../auth/jwt.js";
import {
  type StoredToken,
  deleteToken,
  listPlatformHosts,
  readConfig,
  readToken,
  writeConfig,
  writeToken,
} from "../config/store.js";
import { InputError } from "../utils/errors.js";

export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function usernameOf(token: StoredToken | undefined): string | undefined {
  if (!token) return undefined;
  const claims = decodeJwt(token.accessToken);
  return token.username ?? claims?.preferred_username ?? claims?.name ?? claims?.sub;
}

/** Save a token for a platform and make it the active base URL. */
export function attachToken(
  baseUrl: string,
  accessToken: string,
  opts: { refreshToken?: string; insecure?: boolean } = {},
): { host: string; username?: string } {
  const host = hostOf(baseUrl);
  const token: StoredToken = {
    accessToken,
    refreshToken: opts.refreshToken,
    insecure: opts.insecure,
    username: decodeJwt(accessToken)?.preferred_username,
  };
  writeToken(host, token);
  const config = readConfig();
  config.baseUrl = baseUrl.replace(/\/+$/, "");
  writeConfig(config);
  return { host, username: usernameOf(token) };
}

export interface AuthStatus {
  baseUrl?: string;
  host?: string;
  hasToken: boolean;
  username?: string;
  expired?: boolean;
}

export function status(): AuthStatus {
  const baseUrl = readConfig().baseUrl;
  if (!baseUrl) return { hasToken: false };
  const host = hostOf(baseUrl);
  const token = readToken(host);
  return {
    baseUrl,
    host,
    hasToken: token !== undefined,
    username: usernameOf(token),
    expired: token ? isExpired(decodeJwt(token.accessToken)) : undefined,
  };
}

/** The active platform's access token. Throws if none. */
export function currentToken(): string {
  const baseUrl = readConfig().baseUrl;
  const token = baseUrl ? readToken(hostOf(baseUrl)) : undefined;
  if (!token) throw new InputError("Not logged in. Run `openbkn auth login <url> --token <t>`.");
  return token.accessToken;
}

/** Decoded identity claims of the active token. */
export function whoami(): JwtClaims {
  const claims = decodeJwt(currentToken());
  if (!claims) throw new InputError("Active token is not a decodable JWT.");
  return claims;
}

export interface PlatformEntry {
  host: string;
  username?: string;
  active: boolean;
}

export function listPlatforms(): PlatformEntry[] {
  const activeHost = readConfig().baseUrl ? hostOf(readConfig().baseUrl as string) : undefined;
  return listPlatformHosts().map((host) => ({
    host,
    username: usernameOf(readToken(host)),
    active: host === activeHost,
  }));
}

/** Switch the active platform (must already have a saved token). */
export function use(baseUrl: string): void {
  const host = hostOf(baseUrl);
  if (!readToken(host)) {
    throw new InputError(`No saved credentials for ${host}. Run \`openbkn auth login\` first.`);
  }
  const config = readConfig();
  config.baseUrl = baseUrl.replace(/\/+$/, "");
  writeConfig(config);
}

export function logout(): boolean {
  const baseUrl = readConfig().baseUrl;
  if (!baseUrl) return false;
  return deleteToken(hostOf(baseUrl));
}

export function deletePlatform(baseUrl: string): boolean {
  return deleteToken(hostOf(baseUrl));
}
