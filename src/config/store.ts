import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
/**
 * Local config + token store under `~/.bkn/` (override: `BKN_CONFIG_DIR`).
 * Pure functions — nothing runs at import time.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredConfig {
  baseUrl?: string;
  businessDomain?: string;
}

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  username?: string;
  insecure?: boolean;
}

export function configDir(): string {
  return process.env.BKN_CONFIG_DIR ?? join(homedir(), ".bkn");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

function tokenPath(host: string): string {
  // One token file per platform host.
  return join(configDir(), "platforms", encodeURIComponent(host), "token.json");
}

export function readConfig(): StoredConfig {
  return readJson<StoredConfig>(configPath()) ?? {};
}

export function writeConfig(config: StoredConfig): void {
  writeJson(configPath(), config);
}

export function readToken(host: string): StoredToken | undefined {
  return readJson<StoredToken>(tokenPath(host));
}

export function writeToken(host: string, token: StoredToken): void {
  writeJson(tokenPath(host), token, 0o600);
}

/** Remove a platform's stored token. Returns true if a file was deleted. */
export function deleteToken(host: string): boolean {
  const path = tokenPath(host);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

/** List platform hosts that have a saved token. */
export function listPlatformHosts(): string[] {
  const dir = join(configDir(), "platforms");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((entry) => decodeURIComponent(entry))
    .filter((host) => readToken(host) !== undefined);
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown, mode = 0o644): void {
  mkdirSync(dirOf(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/")) || ".";
}
