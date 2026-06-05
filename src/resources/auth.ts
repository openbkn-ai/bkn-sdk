/**
 * Auth resource — credential store + identity (multi-user, store-backed).
 * Interactive browser/password OAuth lives in `auth/oauth.ts` and is persisted
 * here via `attachToken`.
 */
import { type JwtClaims, decodeJwt, isExpired } from "../auth/jwt.js";
import {
  type PlatformUser,
  type TokenConfig,
  activePlatform,
  activeUserId,
  deleteToken,
  listPlatforms as listStored,
  readToken,
  setActivePlatform,
  setActiveUser,
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
  const baseUrl = activePlatform();
  const token = baseUrl ? readToken(baseUrl) : undefined;
  // The access token may be Ory-opaque; the id_token carries the JWT identity.
  const claims = decodeJwt(token?.idToken ?? "") ?? decodeJwt(token?.accessToken ?? "");
  if (!claims) {
    throw new InputError(
      "No decodable identity (token is opaque and no id_token saved). Use `auth status`.",
    );
  }
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

/** Switch the active user for a platform (token must already be saved). */
export function switchUser(baseUrl: string, userId: string): { baseUrl: string; userId: string } {
  const url = normalize(baseUrl);
  if (!readToken(url, userId)) {
    throw new InputError(`No saved token for user '${userId}' on ${url}.`);
  }
  setActiveUser(url, userId);
  setActivePlatform(url);
  return { baseUrl: url, userId };
}

/** List saved user profiles for one platform. */
export function usersOf(baseUrl: string): PlatformUser[] {
  const url = normalize(baseUrl);
  return listStored().find((p) => p.baseUrl === url)?.users ?? [];
}

/** Export the active session's tokens (for seeding a headless host). */
export function exportCreds(): {
  baseUrl: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
} {
  const baseUrl = activePlatform();
  if (!baseUrl) throw new InputError("No active platform. Run `openbkn auth login` first.");
  const token = readToken(baseUrl);
  if (!token) throw new InputError(`No saved token for ${baseUrl}.`);
  return {
    baseUrl,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    idToken: token.idToken,
  };
}

export { userIdFromToken };
