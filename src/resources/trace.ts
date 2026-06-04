/** Trace resource surface (data fetch + symbolic diagnose). */
import { getRawSpansByConversation, getSpansByConversation, traceSearch } from "../api/trace.js";
import {
  BUILTIN_RULES,
  type DiagnoseReport,
  assembleTraceTree,
  runRules,
} from "../trace-ai/diagnose.js";
import type { RequestContext } from "../types.js";

export function trace(ctx: RequestContext) {
  return {
    /** Raw trace search (OpenSearch-style body). */
    search: (body: unknown) => traceSearch(ctx, body),
    /** All span source docs for a conversation. */
    spans: (conversationId: string, opts?: { maxTraceIds?: number; maxSpans?: number }) =>
      getSpansByConversation(ctx, conversationId, opts),
    /** Symbolic (rules-only) diagnosis of a conversation's primary trace. */
    diagnose: async (conversationId: string): Promise<DiagnoseReport> => {
      const { spans, traceIds } = await getRawSpansByConversation(ctx, conversationId);
      if (spans.length === 0) throw new Error(`No spans found for conversation: ${conversationId}`);
      const primaryTraceId = traceIds[0] ?? conversationId;
      const spansForPrimary =
        traceIds.length > 0
          ? spans.filter((s) => !s.traceId || s.traceId === primaryTraceId)
          : spans;
      const tree = assembleTraceTree(primaryTraceId, spansForPrimary);
      const findings = runRules(tree);
      return {
        traceId: primaryTraceId,
        conversationId,
        diagnosedAt: null,
        mode: "symbolic-only",
        rulesApplied: BUILTIN_RULES.map((r) => r.id),
        findingCount: findings.length,
        findings,
      };
    },
  };
}
