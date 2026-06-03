import { type RawCallOptions, type RawCallResult, rawCall } from "./api/call.js";
import { resolveContext } from "./config/resolve.js";
import { kn } from "./resources/knowledge-networks.js";
import { resources } from "./resources/resources.js";
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
    vega: vega(ctx),
    call: (path, callOpts) => rawCall(ctx, path, callOpts),
  };
}
