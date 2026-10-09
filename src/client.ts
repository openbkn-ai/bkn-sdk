// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { type RawCallOptions, type RawCallResult, rawCall } from "./api/call.js";
import { credentialDeviceLogin } from "./auth/oauth.js";
import { resolveContext } from "./config/resolve.js";
import { admin } from "./resources/admin.js";
import { appKeys } from "./resources/app-keys.js";
import { context } from "./resources/context-loader.js";
import { functions } from "./resources/functions.js";
import { kn } from "./resources/knowledge-networks.js";
import { mcp } from "./resources/mcp.js";
import { models } from "./resources/models.js";
import { resources } from "./resources/resources.js";
import { skills } from "./resources/skills.js";
import { toolboxes } from "./resources/toolboxes.js";
import { trace } from "./resources/trace.js";
import { vega } from "./resources/vega.js";
/**
 * createClient — the primary entry for SDK consumers.
 *
 *   import { createClient } from "@openbkn/bkn-sdk";
 *   const bkn = createClient({ baseUrl, token });
 *   const task = await bkn.vega.build({ resource_id, mode: "batch" }, { wait: true });
 *
 * Resolving the context here (not at import) keeps `import` side-effect free.
 */
import type {
  AuthenticatedClientOptions,
  ClientOptions,
  RefreshableTokens,
  RequestContext,
} from "./types.js";
import { InputError } from "./utils/errors.js";

export interface BknClient {
  readonly ctx: RequestContext;
  readonly kn: ReturnType<typeof kn>;
  readonly resource: ReturnType<typeof resources>;
  readonly context: ReturnType<typeof context>;
  readonly models: ReturnType<typeof models>;
  readonly functions: ReturnType<typeof functions>;
  readonly mcp: ReturnType<typeof mcp>;
  readonly skills: ReturnType<typeof skills>;
  readonly toolboxes: ReturnType<typeof toolboxes>;
  readonly trace: ReturnType<typeof trace>;
  readonly admin: ReturnType<typeof admin>;
  readonly appKeys: ReturnType<typeof appKeys>;
  readonly vega: ReturnType<typeof vega>;
  /** Raw API passthrough (the `call` escape hatch). */
  call(path: string, opts?: RawCallOptions): Promise<RawCallResult>;
}

export function createClient(opts: ClientOptions = {}): BknClient {
  const ctx = resolveContext(opts);
  return clientForContext(ctx);
}

/**
 * Establish an account-backed OAuth session and return a refreshable SDK client.
 *
 * This is intended for Node.js services that cannot rely on a prior CLI login
 * or a session stored in `~/.bkn`. Credentials are used only to establish the
 * OAuth session and are never written to disk by the SDK.
 */
export async function createAuthenticatedClient(
  opts: AuthenticatedClientOptions,
): Promise<BknClient> {
  const { auth, baseUrl, onTokenRefresh, ...clientOptions } = opts;
  if (!auth.username || !auth.password) {
    throw new InputError("Account authentication requires a non-empty username and password.");
  }

  const tokens = await credentialDeviceLogin(baseUrl, auth.username, auth.password, {
    insecure: clientOptions.insecure,
  });
  const client = createClient({ ...clientOptions, baseUrl, token: tokens.accessToken });

  if (tokens.refreshToken) {
    client.ctx.refresh = {
      refreshToken: tokens.refreshToken,
      ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
      persist: (next: RefreshableTokens) => onTokenRefresh?.(next),
    };
  }

  return client;
}

function clientForContext(ctx: RequestContext): BknClient {
  return {
    ctx,
    kn: kn(ctx),
    resource: resources(ctx),
    context: context(ctx),
    models: models(ctx),
    functions: functions(ctx),
    mcp: mcp(ctx),
    skills: skills(ctx),
    toolboxes: toolboxes(ctx),
    trace: trace(ctx),
    admin: admin(ctx),
    appKeys: appKeys(ctx),
    vega: vega(ctx),
    call: (path, callOpts) => rawCall(ctx, path, callOpts),
  };
}
