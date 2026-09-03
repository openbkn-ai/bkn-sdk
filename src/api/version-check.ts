// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Platform-version preflight shared by typed requests and the raw call escape hatch. */
import pkg from "../../package.json" with { type: "json" };
import { readVersionCheckCache, writeVersionCheckCache } from "../config/store.js";
import type { RequestContext } from "../types.js";
import { isDryRun } from "../utils/dry-run.js";
import { tlsFetch } from "./tls.js";

const VERSION_PATH = "/api/bkn-backend/v1/health";
const CLI_CACHE_TTL_MS = 60_000;
const HEALTH_TIMEOUT_MS = 5_000;

type VersionCheckMode = "memory" | "cli";

interface VersionCheckState {
  mode: VersionCheckMode;
  verified?: true;
  verifying?: Promise<void>;
}

// Keep verification state out of the public RequestContext contract. A caller
// that uses the low-level public APIs must not be able to forge `verified`.
const states = new WeakMap<RequestContext, VersionCheckState>();

/** Register the request mode while constructing an SDK or CLI context. */
export function configureVersionCheck(ctx: RequestContext, mode: VersionCheckMode): void {
  states.set(ctx, { mode });
}

/** Preserve one client's private state when an internal helper derives a context. */
export function inheritVersionCheck(from: RequestContext, to: RequestContext): RequestContext {
  const state = states.get(from);
  if (state) states.set(to, state);
  return to;
}

/** Test-only hook for unit tests that isolate an API's business wire contract. */
export function markVersionCompatibleForTest(ctx: RequestContext): void {
  stateFor(ctx).verified = true;
}

/** Thrown before a business request when an unstable-platform version cannot be trusted. */
export class VersionCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionCompatibilityError";
  }
}

/** Ensure the target platform matches this SDK's base SemVer version. */
export async function ensureCompatible(ctx: RequestContext, target: URL): Promise<void> {
  // Credentials and compatibility state belong to one configured platform.  A
  // raw absolute URL must not use this platform's successful check to reach a
  // different server.
  if (target.origin !== new URL(ctx.baseUrl).origin) {
    throw new VersionCompatibilityError(
      `Cannot send a request to ${target.origin}: it differs from the configured platform ${new URL(ctx.baseUrl).origin}.`,
    );
  }

  // Low-level public APIs also accept manually constructed contexts. Their
  // first request uses the default in-memory mode.
  const state = stateFor(ctx);
  if (state.verified || isDryRun() || isVersionUrl(target)) return;
  if (state.verifying) return state.verifying;

  const checking = checkCompatibility(ctx);
  state.verifying = checking;
  try {
    await checking;
    state.verified = true;
  } finally {
    if (state.verifying === checking) state.verifying = undefined;
  }
}

function isVersionUrl(url: URL): boolean {
  return url.pathname.replace(/\/+$/, "") === VERSION_PATH;
}

async function checkCompatibility(ctx: RequestContext): Promise<void> {
  const sdkVersion = baseVersion(pkg.version);
  if (!sdkVersion) {
    throw new VersionCompatibilityError(`SDK version '${pkg.version}' is not valid SemVer.`);
  }

  if (stateFor(ctx).mode === "cli") {
    const cached = readVersionCheckCache(ctx.baseUrl);
    if (cached && isFresh(cached.checkedAt) && compatible(sdkVersion, cached.serverVersion)) return;
  }

  const serverVersion = await readServerVersion(ctx);
  if (!compatible(sdkVersion, serverVersion)) {
    throw new VersionCompatibilityError(
      `SDK version ${pkg.version} is incompatible with platform version ${serverVersion}. ` +
        `Install SDK ${serverVersion}, or connect to a platform running version ${sdkVersion}.`,
    );
  }

  if (stateFor(ctx).mode === "cli") {
    // The cache only saves one health request on a later CLI invocation. A
    // read-only config directory must not prevent an otherwise valid request.
    try {
      writeVersionCheckCache(ctx.baseUrl, { serverVersion, checkedAt: new Date().toISOString() });
    } catch {
      // Best-effort cache persistence.
    }
  }
}

function stateFor(ctx: RequestContext): VersionCheckState {
  let state = states.get(ctx);
  if (!state) {
    state = { mode: "memory" };
    states.set(ctx, state);
  }
  return state;
}

function isFresh(checkedAt: string): boolean {
  const checked = Date.parse(checkedAt);
  return (
    Number.isFinite(checked) && checked <= Date.now() && Date.now() - checked < CLI_CACHE_TTL_MS
  );
}

async function readServerVersion(ctx: RequestContext): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await tlsFetch(ctx.insecure, `${ctx.baseUrl}${VERSION_PATH}`, {
      method: "GET",
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new VersionCompatibilityError(
        `Cannot verify platform version: GET ${VERSION_PATH} returned HTTP ${response.status}. The request was not sent.`,
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new VersionCompatibilityError(
        `Cannot verify platform version: GET ${VERSION_PATH} did not return JSON. The request was not sent.`,
      );
    }
    const version = serverVersionOf(payload);
    if (!version || !baseVersion(version)) {
      throw new VersionCompatibilityError(
        `Cannot verify platform version: GET ${VERSION_PATH} did not return a valid ServerVersion. The request was not sent.`,
      );
    }
    return version;
  } catch (error) {
    if (error instanceof VersionCompatibilityError) throw error;
    throw new VersionCompatibilityError(
      `Cannot verify platform version from GET ${VERSION_PATH}: ${error instanceof Error ? error.message : "request failed"}. The request was not sent.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function serverVersionOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const outer = payload as Record<string, unknown>;
  const nested =
    outer.data && typeof outer.data === "object" ? (outer.data as Record<string, unknown>) : outer;
  const version = nested.ServerVersion ?? nested.serverVersion;
  return typeof version === "string" ? version : undefined;
}

function compatible(sdkBaseVersion: string, serverVersion: string): boolean {
  return sdkBaseVersion === baseVersion(serverVersion);
}

/** Strip prerelease/build metadata; `0.x` compatibility remains exact at patch level. */
export function baseVersion(version: string): string | undefined {
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version,
    );
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
}
