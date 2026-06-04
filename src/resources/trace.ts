/** Trace resource surface (data fetch + symbolic diagnose). */
import { getRawSpansByConversation, getSpansByConversation, traceSearch } from "../api/trace.js";
import { claudeAvailable, judgeJson } from "../trace-ai/claude-judge.js";
import {
  BUILTIN_RULES,
  type DiagnoseReport,
  assembleTraceTree,
  runRubric,
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
    /**
     * Diagnose a conversation's primary trace. Symbolic rules always run; when
     * `llm` is set and a local `claude` CLI is available, gated rubric rules add
     * an LLM-judged second pillar (hybrid mode).
     */
    diagnose: async (
      conversationId: string,
      opts: { llm?: boolean; judgeTimeoutMs?: number } = {},
    ): Promise<DiagnoseReport> => {
      const { spans, traceIds } = await getRawSpansByConversation(ctx, conversationId);
      if (spans.length === 0) throw new Error(`No spans found for conversation: ${conversationId}`);
      const primaryTraceId = traceIds[0] ?? conversationId;
      const spansForPrimary =
        traceIds.length > 0
          ? spans.filter((s) => !s.traceId || s.traceId === primaryTraceId)
          : spans;
      const tree = assembleTraceTree(primaryTraceId, spansForPrimary);
      const findings = runRules(tree);
      let mode: DiagnoseReport["mode"] = "symbolic-only";
      if (opts.llm && claudeAvailable()) {
        const rubric = await runRubric(tree, findings, (prompt) =>
          judgeJson(prompt, { timeoutMs: opts.judgeTimeoutMs }),
        );
        findings.push(...rubric);
        mode = "hybrid";
      }
      return {
        traceId: primaryTraceId,
        conversationId,
        diagnosedAt: null,
        mode,
        rulesApplied: BUILTIN_RULES.map((r) => r.id),
        findingCount: findings.length,
        findings,
      };
    },
  };
}
