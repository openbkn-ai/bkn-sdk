import { markVersionCompatibleForTest } from "../../src/api/version-check.js";
import type { RequestContext } from "../../src/types.js";

/** Mark a mock context verified when a unit test isolates a business API's wire contract. */
export function verifiedContext<T extends RequestContext>(ctx: T): T {
  markVersionCompatibleForTest(ctx);
  return ctx;
}
