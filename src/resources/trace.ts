// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Trace resource surface (data fetch + symbolic/rubric diagnose + eval-set). */
import { traceLifecycleApi } from "../api/trace-lifecycle.js";
import {
  type TechnicalTraceQuery,
  getRawSpansByConversation,
  getSpansByConversation,
  getTechnicalTrace,
  getTraceGraph,
  listTechnicalTraces,
} from "../api/trace.js";
import { claudeAvailable, judgeJson } from "../bkn-trace/claude-judge.js";
import {
  BUILTIN_RULES,
  type DiagnoseReport,
  type Summary,
  assembleTraceTree,
  runRubric,
  runRules,
  synthesizeFindings,
} from "../bkn-trace/diagnose.js";
import { type EvalCase, buildCasesFromQueries } from "../bkn-trace/eval-set.js";
import { validateFixturePath } from "../bkn-trace/fixture-validate.js";
import { ManagedTrace } from "../managed-trace.js";
import type { RequestContext } from "../types.js";

export function trace(ctx: RequestContext) {
  const lifecycle = traceLifecycleApi(ctx);
  const managed = new ManagedTrace(lifecycle);
  /**
   * Diagnose a conversation's primary trace. Symbolic rules always run; when
   * `llm` is set and a local `claude` CLI is available, gated rubric rules add
   * an LLM-judged second pillar + a synthesized summary (hybrid mode).
   */
  const diagnoseOne = async (
    conversationId: string,
    opts: { llm?: boolean; judgeTimeoutMs?: number } = {},
  ): Promise<DiagnoseReport> => {
    const { spans, traceIds } = await getRawSpansByConversation(ctx, conversationId);
    if (spans.length === 0) throw new Error(`No spans found for conversation: ${conversationId}`);
    const primaryTraceId = traceIds[0] ?? conversationId;
    const spansForPrimary =
      traceIds.length > 0 ? spans.filter((s) => !s.traceId || s.traceId === primaryTraceId) : spans;
    const tree = assembleTraceTree(primaryTraceId, spansForPrimary);
    const applicableRules = BUILTIN_RULES.filter((rule) => isRuleApplicable(rule.id, tree.spans));
    const skippedRules = BUILTIN_RULES.filter((rule) => !applicableRules.includes(rule)).map(
      (rule) => rule.id,
    );
    const findings = runRules(tree, applicableRules);
    let mode: DiagnoseReport["mode"] = "symbolic-only";
    let summary: Summary | undefined;
    if (opts.llm && claudeAvailable()) {
      const judge = (prompt: string) => judgeJson(prompt, { timeoutMs: opts.judgeTimeoutMs });
      const rubric = await runRubric(tree, findings, judge);
      findings.push(...rubric);
      summary = await synthesizeFindings(findings, judge);
      mode = "hybrid";
    }
    return {
      traceId: primaryTraceId,
      conversationId,
      diagnosedAt: null,
      mode,
      rulesApplied: applicableRules.map((rule) => rule.id),
      ...(skippedRules.length > 0
        ? {
            skippedRules,
            partial: true,
            partialReasons: [
              "typed Trace facts do not contain the attributes required by these rules",
            ],
          }
        : {}),
      findingCount: findings.length,
      ...(summary ? { summary } : {}),
      findings,
    };
  };

  return {
    /** Low-level BKN Trace 3.0 lifecycle and durable receipt API. */
    lifecycle,
    /** Own one complete interaction lifecycle around an application callback. */
    withInteraction: managed.withInteraction.bind(managed),
    /** Authorized typed technical Trace list. */
    search: (query: TechnicalTraceQuery = {}) => listTechnicalTraces(ctx, query),
    /** One technical Trace with Span and Operation facts. */
    get: (traceId: string) => getTechnicalTrace(ctx, traceId),
    /** Normalized trace tree/status graph by trace id. */
    graph: (traceId: string) => getTraceGraph(ctx, traceId),
    /** All span source docs for a conversation. */
    spans: (conversationId: string, opts?: { maxTraceIds?: number; maxSpans?: number }) =>
      getSpansByConversation(ctx, conversationId, opts),
    diagnose: diagnoseOne,
    /**
     * Scan (batch-diagnose) several conversations and aggregate the findings:
     * per-trace reports + a recurring-rule tally across the batch.
     */
    scan: async (
      conversationIds: string[],
      opts: { llm?: boolean; judgeTimeoutMs?: number } = {},
    ) => {
      const reports = [];
      for (const id of conversationIds) {
        try {
          reports.push(await diagnoseOne(id, opts));
        } catch (e) {
          reports.push({
            conversationId: id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      const byRule: Record<string, number> = {};
      let totalFindings = 0;
      for (const r of reports) {
        if (!("findings" in r)) continue;
        for (const f of r.findings) {
          byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
          totalFindings += 1;
        }
      }
      return {
        scanned: conversationIds.length,
        totalFindings,
        recurringRules: Object.entries(byRule)
          .sort((a, b) => b[1] - a[1])
          .map(([ruleId, count]) => ({ ruleId, count })),
        reports,
      };
    },
    /** Build eval cases from a loosely-shaped queries object/array. */
    evalSetBuild: (raw: unknown): EvalCase[] => buildCasesFromQueries(raw),
    /** Validate BKN Trace phase-one fixture files or directories. */
    validateFixture: (path: string) => validateFixturePath(path),
  };
}

function isRuleApplicable(
  ruleId: string,
  spans: Array<{ kind: string; status: string; attributes: Record<string, unknown> }>,
): boolean {
  const tools = spans.filter((span) => span.kind === "tool");
  const llms = spans.filter((span) => span.kind === "llm");
  const retrievals = spans.filter((span) => span.kind === "retrieval");
  switch (ruleId) {
    case "tool_loop_no_state_change":
      return tools.some((span) => Object.hasOwn(span.attributes, "gen_ai.conversation.state"));
    case "tool_error_swallowed":
      return (
        tools.some((span) => span.status === "error") &&
        llms.some(
          (span) =>
            Object.hasOwn(span.attributes, "gen_ai.prompt") ||
            Object.hasOwn(span.attributes, "llm.prompt"),
        )
      );
    case "retrieval_empty_no_fallback":
      return retrievals.some((span) =>
        Object.hasOwn(span.attributes, "gen_ai.retrieval.result_count"),
      );
    case "llm_response_truncated_no_continue":
      return llms.some(
        (span) =>
          Object.hasOwn(span.attributes, "gen_ai.response.finish_reasons") ||
          Object.hasOwn(span.attributes, "gen_ai.response.finish_reason") ||
          Object.hasOwn(span.attributes, "llm.finish_reason"),
      );
    case "excessive_tool_calls_per_turn":
      return true;
    default:
      return true;
  }
}
