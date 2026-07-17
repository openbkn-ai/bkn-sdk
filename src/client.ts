// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { type RawCallOptions, type RawCallResult, rawCall } from "./api/call.js";
import { resolveContext } from "./config/resolve.js";
import { admin } from "./resources/admin.js";
import { agents } from "./resources/agents.js";
import { appKeys } from "./resources/app-keys.js";
import { context } from "./resources/context-loader.js";
import { dataflows } from "./resources/dataflows.js";
import { kn } from "./resources/knowledge-networks.js";
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
import type { ClientOptions, RequestContext } from "./types.js";

export interface BknClient {
  readonly ctx: RequestContext;
  readonly kn: ReturnType<typeof kn>;
  readonly resource: ReturnType<typeof resources>;
  readonly dataflows: ReturnType<typeof dataflows>;
  /**
   * @deprecated Decision Agent (agent-factory) is being phased out and may be
   * removed in a future release. Avoid building new integrations on it.
   */
  readonly agents: ReturnType<typeof agents>;
  readonly context: ReturnType<typeof context>;
  readonly models: ReturnType<typeof models>;
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
  return {
    ctx,
    kn: kn(ctx),
    resource: resources(ctx),
    dataflows: dataflows(ctx),
    agents: agents(ctx),
    context: context(ctx),
    models: models(ctx),
    skills: skills(ctx),
    toolboxes: toolboxes(ctx),
    trace: trace(ctx),
    admin: admin(ctx),
    appKeys: appKeys(ctx),
    vega: vega(ctx),
    call: (path, callOpts) => rawCall(ctx, path, callOpts),
  };
}
