/** Trace resource surface (data fetch). */
import { getSpansByConversation, traceSearch } from "../api/trace.js";
import type { RequestContext } from "../types.js";

export function trace(ctx: RequestContext) {
  return {
    /** Raw trace search (OpenSearch-style body). */
    search: (body: unknown) => traceSearch(ctx, body),
    /** All span source docs for a conversation. */
    spans: (conversationId: string, opts?: { maxTraceIds?: number; maxSpans?: number }) =>
      getSpansByConversation(ctx, conversationId, opts),
  };
}
