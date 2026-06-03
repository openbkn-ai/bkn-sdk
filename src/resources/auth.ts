/**
 * Auth resource — credential store + identity (multi-user, store-backed).
 * Interactive browser/password OAuth is staged (no deployed env yet) and lives
 * in `auth/oauth.ts`.
 */
import { type JwtClaims, decodeJwt, isExpired } from "../auth/jwt.js";
import {
  type TokenConfig,
  activePlatform,
  activeUserId,
  deleteToken,
  listPlatforms as listStored,
  readToken,
  setActivePlatform,
  userIdFromToken,
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

function normalize(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function usernameOf(token: TokenConfig | undefined): string | undefined {
  if (!token) return undefined;
  const claims = decodeJwt(token.accessToken);
  return (
    token.username ?? token.displayName ?? claims?.preferred_username ?? claims?.name ?? claims?.sub
  );
}

/** Save a token (under its derived user) and make it the active platform/user. */
export function attachToken(
  baseUrl: string,
  accessToken: string,
  opts: { refreshToken?: string; idToken?: string; insecure?: boolean } = {},
): { baseUrl: string; userId: string; username?: string } {
  const url = normalize(baseUrl);
  const token: TokenConfig = {
    baseUrl: url,
    accessToken,
    refreshToken: opts.refreshToken,
    idToken: opts.idToken,
    tlsInsecure: opts.insecure,
    username: decodeJwt(opts.idToken ?? accessToken)?.preferred_username,
  };
  const userId = writeToken(url, token); // also sets active user
  setActivePlatform(url);
  return { baseUrl: url, userId, username: usernameOf(token) };
}

export interface AuthStatus {
  baseUrl?: string;
  userId?: string;
  hasToken: boolean;
  username?: string;
  expired?: boolean;
}

export function status(): AuthStatus {
  const baseUrl = activePlatform();
  if (!baseUrl) return { hasToken: false };
  const token = readToken(baseUrl);
  return {
    baseUrl,
    userId: activeUserId(baseUrl),
    hasToken: token !== undefined,
    username: usernameOf(token),
    expired: token ? isExpired(decodeJwt(token.accessToken)) : undefined,
  };
}

export function currentToken(): string {
  const baseUrl = activePlatform();
  const token = baseUrl ? readToken(baseUrl) : undefined;
  if (!token) throw new InputError("Not logged in. Run `openbkn auth login <url> --token <t>`.");
  return token.accessToken;
}

export function whoami(): JwtClaims {
  const claims = decodeJwt(currentToken());
  if (!claims) throw new InputError("Active token is not a decodable JWT.");
  return claims;
}

export interface PlatformListItem {
  baseUrl: string;
  userId: string;
  username?: string;
  active: boolean;
}

/** Flat list of platform/user pairs with a saved session. */
export function listPlatforms(): PlatformListItem[] {
  const current = activePlatform();
  return listStored().flatMap((p) =>
    p.users.map((u) => ({
      baseUrl: p.baseUrl,
      userId: u.userId,
      username: u.username ?? u.displayName,
      active: p.baseUrl === current && u.userId === p.activeUserId,
    })),
  );
}

/** Switch the active platform (must already have a saved token). */
export function use(baseUrl: string): void {
  const url = normalize(baseUrl);
  if (!readToken(url)) {
    throw new InputError(`No saved credentials for ${url}. Run \`openbkn auth login\` first.`);
  }
  setActivePlatform(url);
}

export function logout(): boolean {
  const baseUrl = activePlatform();
  return baseUrl ? deleteToken(baseUrl) : false;
}

export function deletePlatform(baseUrl: string, userId?: string): boolean {
  return deleteToken(normalize(baseUrl), userId);
}

export { userIdFromToken };
