// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Local config + token store under `~/.bkn/` (override: `BKN_CONFIG_DIR`).
 *
 * Multi-user by design (platforms are multi-tenant), aligned with the
 * legacy layout — reimplemented slim, no legacy-migration paths:
 *
 *   <root>/state.json                      (or profiles/<BKN_PROFILE>/state.json)
 *   <root>/platforms/<base64url(baseUrl)>/users/<userId>/token.json
 *   <root>/platforms/<base64url(baseUrl)>/users/<userId>/config.json
 *
 * Active platform + per-platform active user live in state.json, so several
 * accounts on one platform coexist and `--user` can switch between them.
 * Pure functions — nothing runs at import time.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { decodeJwt } from "../auth/jwt.js";

export interface TokenConfig {
  baseUrl: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: string;
  /** Login name persisted at login time (fallback when JWT lacks claims). */
  username?: string;
  /** Human-readable name from userinfo. */
  displayName?: string;
  /**
   * Skip TLS verification for this platform (saved by `auth login -k`), so a
   * self-signed platform needn't repeat `-k` on every command. The opt-out is
   * applied per request via an undici dispatcher (see api/tls.ts) and is scoped
   * to this platform's requests — it never touches the global TLS setting or a
   * library consumer's unrelated traffic.
   */
  tlsInsecure?: boolean;
}

/** Per-platform, per-user non-auth settings. */
export interface PlatformConfig {
  businessDomain?: string;
}

interface StoreState {
  currentPlatform?: string;
  /** baseUrl → active userId. */
  activeUsers?: Record<string, string>;
}

const PROFILE_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** A userId becomes a path segment under the store — it must not escape it. */
const USER_ID_RE = /^[A-Za-z0-9._@-]{1,128}$/;
const IS_WIN = process.platform === "win32";

export function configDir(): string {
  return process.env.BKN_CONFIG_DIR ?? join(homedir(), ".bkn");
}

function profileName(): string | null {
  const raw = process.env.BKN_PROFILE?.trim();
  if (!raw) return null;
  if (!PROFILE_RE.test(raw)) {
    throw new Error(`BKN_PROFILE='${raw}' is invalid. Use 1-64 chars from [A-Za-z0-9_-].`);
  }
  return raw;
}

function statePath(): string {
  const profile = profileName();
  return profile
    ? join(configDir(), "profiles", profile, "state.json")
    : join(configDir(), "state.json");
}

function encodeKey(baseUrl: string): string {
  return Buffer.from(baseUrl, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function platformDir(baseUrl: string): string {
  return join(configDir(), "platforms", encodeKey(baseUrl));
}

function userDir(baseUrl: string, userId: string): string {
  return join(platformDir(baseUrl), "users", userId);
}

/**
 * userId from the token's JWT `sub` (id_token first), else "default".
 *
 * The `sub` is attacker-supplied — the JWT is never signature-checked — and it
 * becomes a path segment under `userDir`. An unconstrained one escapes the
 * store: `sub: "../../<other-platform>/users/default"` overwrites another
 * platform's saved token, so the victim's later commands there authenticate as
 * whoever issued this token. Constrain it the way BKN_PROFILE is constrained.
 */
export function userIdFromToken(token: TokenConfig): string {
  const sub = decodeJwt(token.idToken ?? "")?.sub ?? decodeJwt(token.accessToken)?.sub;
  if (sub === undefined) return "default";
  if (typeof sub !== "string" || !USER_ID_RE.test(sub) || sub === "." || sub === "..") {
    throw new Error(
      `Token subject '${String(sub)}' is not a usable user id (expected 1-128 chars from [A-Za-z0-9._@-]). Refusing to store this token.`,
    );
  }
  return sub;
}

// ---- state ----------------------------------------------------------------

function readState(): StoreState {
  return readJson<StoreState>(statePath()) ?? {};
}

function writeState(state: StoreState): void {
  writeJson(statePath(), state);
}

export function activePlatform(): string | undefined {
  return readState().currentPlatform;
}

export function setActivePlatform(baseUrl: string): void {
  writeState({ ...readState(), currentPlatform: baseUrl });
}

export function activeUserId(baseUrl: string): string | undefined {
  return readState().activeUsers?.[baseUrl];
}

export function setActiveUser(baseUrl: string, userId: string): void {
  const state = readState();
  writeState({ ...state, activeUsers: { ...state.activeUsers, [baseUrl]: userId } });
}

// ---- tokens (user-scoped) --------------------------------------------------

/** Read the active user's token for a platform (or a specific userId). */
export function readToken(
  baseUrl: string,
  userId = activeUserId(baseUrl),
): TokenConfig | undefined {
  if (!userId) return undefined;
  return readJson<TokenConfig>(join(userDir(baseUrl, userId), "token.json")) ?? undefined;
}

/**
 * Persist a token under its derived userId and, by default, make it the active
 * user. Pass `setActive: false` for a write that must not move the active user
 * — a `--user` request refreshing its own token is transient, and switching the
 * default identity as a side effect of a refresh would outlive the command.
 */
export function writeToken(
  baseUrl: string,
  token: TokenConfig,
  opts: { setActive?: boolean } = {},
): string {
  const userId = userIdFromToken(token);
  writeJson(join(userDir(baseUrl, userId), "token.json"), token, 0o600);
  if (opts.setActive !== false) setActiveUser(baseUrl, userId);
  return userId;
}

export function deleteToken(baseUrl: string, userId = activeUserId(baseUrl)): boolean {
  if (!userId) return false;
  const path = join(userDir(baseUrl, userId), "token.json");
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

// ---- per-platform/user config ---------------------------------------------

export function readPlatformConfig(
  baseUrl: string,
  userId = activeUserId(baseUrl),
): PlatformConfig {
  if (!userId) return {};
  return readJson<PlatformConfig>(join(userDir(baseUrl, userId), "config.json")) ?? {};
}

export function writePlatformConfig(baseUrl: string, config: PlatformConfig): void {
  const userId = activeUserId(baseUrl) ?? "default";
  writeJson(join(userDir(baseUrl, userId), "config.json"), config);
}

// ---- enumeration -----------------------------------------------------------

export interface PlatformUser {
  userId: string;
  username?: string;
  displayName?: string;
}

export interface PlatformEntry {
  baseUrl: string;
  users: PlatformUser[];
  activeUserId?: string;
}

/** Enumerate saved platforms and their users by scanning the store. */
export function listPlatforms(): PlatformEntry[] {
  const root = join(configDir(), "platforms");
  if (!existsSync(root)) return [];
  const state = readState();
  const out: PlatformEntry[] = [];
  for (const key of readdirSync(root)) {
    const baseUrl = decodeKey(key);
    if (!baseUrl) continue;
    const usersRoot = join(root, key, "users");
    if (!existsSync(usersRoot)) continue;
    const users: PlatformUser[] = [];
    for (const userId of readdirSync(usersRoot)) {
      const token = readJson<TokenConfig>(join(usersRoot, userId, "token.json"));
      if (token) users.push({ userId, username: token.username, displayName: token.displayName });
    }
    if (users.length > 0) {
      out.push({ baseUrl, users, activeUserId: state.activeUsers?.[baseUrl] });
    }
  }
  return out;
}

/**
 * Map a `--user` value — a stored user id OR the username saved at login — to a
 * user id, or null when nothing matches. Callers decide what a miss means; the
 * one thing none of them may do is fall back to the active user, since the
 * point of naming a user is to not act as a different one.
 */
export function findUserId(baseUrl: string, userOrName: string): string | null {
  const users = listPlatforms().find((p) => p.baseUrl === baseUrl)?.users ?? [];
  const match =
    users.find((u) => u.userId === userOrName) ??
    users.find((u) => (u.username ?? u.displayName) === userOrName);
  return match?.userId ?? null;
}

/** Saved users for a platform, for building a "did you mean" list. */
export function usersOfPlatform(baseUrl: string): PlatformUser[] {
  return listPlatforms().find((p) => p.baseUrl === baseUrl)?.users ?? [];
}

function decodeKey(key: string): string | null {
  try {
    const b64 = key.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

// ---- low-level fs ----------------------------------------------------------

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown, mode = 0o600): void {
  const dir = path.slice(0, path.lastIndexOf("/")) || ".";
  mkdirSync(dir, { recursive: true, ...(IS_WIN ? {} : { mode: 0o700 }) });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, IS_WIN ? {} : { mode });
  if (!IS_WIN) chmodSync(path, mode);
}
