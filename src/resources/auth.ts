// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Auth resource — credential store + identity (multi-user, store-backed).
 * Interactive browser/password OAuth lives in `auth/oauth.ts` and is persisted
 * here via `attachToken`.
 */
import { type JwtClaims, decodeJwt, isExpired } from "../auth/jwt.js";
import { refreshAccessToken } from "../auth/oauth.js";
import {
  type PlatformUser,
  type TokenConfig,
  activePlatform,
  activeUserId,
  deleteToken,
  findUserId,
  listPlatforms as listStored,
  readToken,
  setActivePlatform,
  setActiveUser,
  userIdFromToken,
  usersOfPlatform,
  writeToken,
} from "../config/store.js";
import { trimTrailingSlashes } from "../utils/base-url.js";
import { isDryRun } from "../utils/dry-run.js";
import { InputError } from "../utils/errors.js";

export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function normalize(baseUrl: string): string {
  return trimTrailingSlashes(baseUrl);
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
  opts: { refreshToken?: string; idToken?: string; username?: string; insecure?: boolean } = {},
): { baseUrl: string; userId: string; username?: string } {
  const url = normalize(baseUrl);
  const token: TokenConfig = {
    baseUrl: url,
    accessToken,
    refreshToken: opts.refreshToken,
    idToken: opts.idToken,
    // Remember `-k` so a self-signed platform needn't repeat it every command.
    tlsInsecure: opts.insecure ? true : undefined,
    // Prefer the account the user typed (-u); device tokens carry no username.
    username: opts.username ?? decodeJwt(opts.idToken ?? accessToken)?.preferred_username,
  };
  const userId = writeToken(url, token); // also sets active user
  setActivePlatform(url);
  return { baseUrl: url, userId, username: usernameOf(token) };
}

/**
 * The user a session-inspection call is about: `--user` when given, else the
 * platform's active user. `auth whoami --user X` is exactly how someone checks
 * which identity `--user X` selects, so it must not answer about a different
 * one.
 */
function targetUser(baseUrl: string, userOrName?: string): string | undefined {
  if (!userOrName) return activeUserId(baseUrl);
  const id = findUserId(baseUrl, userOrName);
  if (!id) {
    const known = usersOfPlatform(baseUrl)
      .map((u) => u.username ?? u.userId)
      .join(", ");
    throw new InputError(
      `No saved user '${userOrName}' on ${baseUrl}. Saved: ${known || "(none)"}.`,
    );
  }
  return id;
}

export interface AuthStatus {
  baseUrl?: string;
  userId?: string;
  hasToken: boolean;
  username?: string;
  expired?: boolean;
}

export function status(opts: { user?: string } = {}): AuthStatus {
  const baseUrl = activePlatform();
  if (!baseUrl) return { hasToken: false };
  const userId = targetUser(baseUrl, opts.user);
  const token = readToken(baseUrl, userId);
  return {
    baseUrl,
    userId,
    hasToken: token !== undefined,
    username: usernameOf(token),
    expired: token ? isExpired(decodeJwt(token.accessToken)) : undefined,
  };
}

export function currentToken(opts: { user?: string } = {}): string {
  const baseUrl = activePlatform();
  const token = baseUrl ? readToken(baseUrl, targetUser(baseUrl, opts.user)) : undefined;
  if (!token) throw new InputError("Not logged in. Run `openbkn auth login <url> --token <t>`.");
  return token.accessToken;
}

/**
 * Like {@link currentToken} but proactively refreshes an expired access token
 * when a refresh token is stored, persisting the result. API requests already
 * refresh on a 401 (see api/http.ts); this covers the `auth token` getter,
 * whose output is copied out and used elsewhere where no 401 retry can help.
 */
export async function currentTokenFresh(
  opts: { insecure?: boolean; user?: string } = {},
): Promise<string> {
  const baseUrl = activePlatform();
  const userId = baseUrl ? targetUser(baseUrl, opts.user) : undefined;
  const token = baseUrl ? readToken(baseUrl, userId) : undefined;
  if (!baseUrl || !token) {
    throw new InputError("Not logged in. Run `openbkn auth login <url> --token <t>`.");
  }
  // Refresh unless we can positively prove the token is still valid. A JWT is
  // refreshed only when its `exp` has passed; an opaque token (Ory access
  // tokens are opaque — no decodable `exp`) is always refreshed, since `auth
  // token`'s output is consumed externally where no 401-retry can recover it.
  const claims = decodeJwt(token.accessToken);
  const decodable = claims?.exp !== undefined;
  const needsRefresh = decodable ? isExpired(claims) : true;
  // Refreshing rotates the stored credential, which `--dry-run` promises not to
  // do. Hand back what is stored, exactly as `--no-refresh` would.
  if (token.refreshToken && needsRefresh && !isDryRun()) {
    try {
      const t = await refreshAccessToken(baseUrl, token.refreshToken, undefined, opts.insecure);
      writeToken(
        baseUrl,
        {
          ...token,
          accessToken: t.accessToken,
          refreshToken: t.refreshToken ?? token.refreshToken,
          idToken: t.idToken ?? token.idToken,
        },
        { setActive: !opts.user },
      );
      return t.accessToken;
    } catch {
      // Refresh failed (revoked / offline) — return the stale token; the
      // caller learns it's expired when the server rejects it.
    }
  }
  return token.accessToken;
}

export interface WhoamiResult extends JwtClaims {
  /** Platform the active session belongs to. */
  baseUrl?: string;
  /** Stored user id (UUID) for the active session. */
  userId?: string;
  /** Resolved account/login name — what `auth login` looked up and stored. */
  username?: string;
}

export function whoami(opts: { user?: string } = {}): WhoamiResult {
  const baseUrl = activePlatform();
  const userId = baseUrl ? targetUser(baseUrl, opts.user) : undefined;
  const token = baseUrl ? readToken(baseUrl, userId) : undefined;
  // The access token may be Ory-opaque; the id_token carries the JWT identity.
  const claims = decodeJwt(token?.idToken ?? "") ?? decodeJwt(token?.accessToken ?? "");
  if (!claims) {
    throw new InputError(
      "No decodable identity (token is opaque and no id_token saved). Use `auth status`.",
    );
  }
  // The device-flow id_token often carries only `sub` (a UUID), so the bare
  // claims don't say *who* you are. Surface the account name resolved + stored
  // at login (falling back to the JWT's own name/preferred_username/sub).
  return {
    ...claims,
    baseUrl: baseUrl ?? undefined,
    userId,
    username: usernameOf(token),
  };
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

/**
 * Switch the active user for a platform. Accepts a stored user id OR a username
 * (the account stored at login), so callers need not know the UUID.
 */
export function switchUser(
  baseUrl: string,
  userOrName: string,
): { baseUrl: string; userId: string; username?: string } {
  const url = normalize(baseUrl);
  const users = usersOf(url);
  const match =
    users.find((u) => u.userId === userOrName) ??
    users.find((u) => (u.username ?? u.displayName) === userOrName);
  if (!match) {
    throw new InputError(`No saved user '${userOrName}' on ${url}. Try \`auth users ${url}\`.`);
  }
  setActiveUser(url, match.userId);
  setActivePlatform(url);
  return { baseUrl: url, userId: match.userId, username: match.username ?? match.displayName };
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
