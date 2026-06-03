/**
 * Trace AI client (agent-observability). Implements raw trace search and a
 * two-hop "spans by conversation" fetch, mirroring kweaver-sdk. The full
 * diagnose/eval-set rule engine (LLM-as-judge) is a separate large feature and
 * is NOT included here — see docs/exec-plans/tech-debt-tracker.md.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const SEARCH = "/api/agent-observability/v1/traces/_search";

interface SearchHits {
  hits?: { hits?: Array<{ _source?: Record<string, unknown> }> };
  aggregations?: { tids?: { buckets?: Array<{ key?: string }> } };
}

/** Raw OpenSearch-style trace search (body passthrough). */
export function traceSearch(ctx: RequestContext, body: unknown): Promise<unknown> {
  return request(ctx, SEARCH, { method: "POST", body });
}

/**
 * Fetch all span `_source` docs for a conversation.
 * Hop 1: aggregate trace ids for the conversation. Hop 2: fetch their spans.
 * (If hop 1 already returns flat hits, that is used directly.)
 */
export async function getSpansByConversation(
  ctx: RequestContext,
  conversationId: string,
  opts: { maxTraceIds?: number; maxSpans?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const agg =
    (await request<SearchHits>(ctx, SEARCH, {
      method: "POST",
      body: {
        size: 0,
        query: { term: { "attributes.gen_ai.conversation.id.keyword": conversationId } },
        aggs: { tids: { terms: { field: "traceId.keyword", size: opts.maxTraceIds ?? 100 } } },
      },
    })) ?? {};

  const direct = agg.hits?.hits;
  if (!agg.aggregations && Array.isArray(direct)) {
    return direct.map((h) => h._source ?? {});
  }

  const traceIds = (agg.aggregations?.tids?.buckets ?? [])
    .map((b) => b.key)
    .filter((k): k is string => typeof k === "string" && k.length > 0);
  if (traceIds.length === 0) return [];

  const spans =
    (await request<SearchHits>(ctx, SEARCH, {
      method: "POST",
      body: {
        size: opts.maxSpans ?? 2000,
        query: { terms: { "traceId.keyword": traceIds } },
      },
    })) ?? {};
  return (spans.hits?.hits ?? []).map((h) => h._source ?? {});
}
