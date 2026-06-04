/** Trace resource surface (data fetch + symbolic/rubric diagnose + eval-set). */
import { fetchAgentInfo, sendChat } from "../api/agent-chat.js";
import { getRawSpansByConversation, getSpansByConversation, traceSearch } from "../api/trace.js";
import { claudeAvailable, judgeJson } from "../trace-ai/claude-judge.js";
import {
  BUILTIN_RULES,
  type DiagnoseReport,
  type Summary,
  assembleTraceTree,
  runRubric,
  runRules,
  synthesizeFindings,
} from "../trace-ai/diagnose.js";
import {
  type EvalCase,
  type EvalSetResult,
  buildCasesFromQueries,
  runEvalSet,
} from "../trace-ai/eval-set.js";
import type { RequestContext } from "../types.js";

async function semanticJudge(
  question: string,
  answer: string,
  reference: string,
): Promise<{ verdict: "pass" | "fail"; reasoning: string }> {
  const prompt = [
    "You judge whether an agent ANSWER semantically matches a REFERENCE answer.",
    question ? `QUESTION/CRITERION: ${question}` : "",
    `ANSWER: ${answer}`,
    `REFERENCE: ${reference}`,
    'Respond with ONLY JSON: {"verdict":"pass|fail","reasoning":"<one sentence>"}',
  ]
    .filter(Boolean)
    .join("\n");
  const out = await judgeJson(prompt, { timeoutMs: 120_000 });
  return {
    verdict: out.verdict === "pass" ? "pass" : "fail",
    reasoning: typeof out.reasoning === "string" ? out.reasoning : "",
  };
}

export function trace(ctx: RequestContext) {
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
    const findings = runRules(tree);
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
      rulesApplied: BUILTIN_RULES.map((r) => r.id),
      findingCount: findings.length,
      ...(summary ? { summary } : {}),
      findings,
    };
  };

  return {
    /** Raw trace search (OpenSearch-style body). */
    search: (body: unknown) => traceSearch(ctx, body),
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
    /**
     * Run an eval set against an agent: each case's query is sent to the agent,
     * the resulting trace is fetched, and assertions are checked. `llm` enables
     * `semantic_match` assertions via the local claude judge.
     */
    evalSetTest: async (
      agentId: string,
      cases: EvalCase[],
      opts: { version?: string; llm?: boolean } = {},
    ): Promise<EvalSetResult> => {
      const info = await fetchAgentInfo(ctx, agentId, opts.version ?? "v0");
      return runEvalSet(agentId, cases, {
        runQuery: async (query) => {
          const res = await sendChat(ctx, info, query, {});
          return { answer: res.text, conversationId: res.conversationId ?? null };
        },
        fetchSpans: async (conversationId) => {
          const { spans, traceIds } = await getRawSpansByConversation(ctx, conversationId);
          const primary = traceIds[0] ?? conversationId;
          return assembleTraceTree(
            primary,
            traceIds.length > 0 ? spans.filter((s) => !s.traceId || s.traceId === primary) : spans,
          ).spans;
        },
        judgeSemanticMatch: opts.llm && claudeAvailable() ? semanticJudge : undefined,
      });
    },
  };
}
