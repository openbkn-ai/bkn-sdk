/**
 * Trace eval-set — build a set of evaluation cases and run them against a live
 * agent. Each case is {query, assertions[]}; `test` runs the query through the
 * agent, fetches the resulting trace, and checks each assertion. Deterministic
 * assertion kinds (contains, regex, tool-call count/order, latency) need no LLM;
 * `semantic_match` reuses the local-claude judge. Builder lifts cases from a
 * queries file (JSON). The diagnosis-report lift + YAML shards + redaction from
 * kweaver-sdk are deferred — see tech-debt.
 */
import type { Span } from "./diagnose.js";

export type AssertionType =
  | "contains"
  | "not_contains"
  | "regex"
  | "tool_call_count"
  | "tool_call_order"
  | "latency_ms"
  | "semantic_match";

export interface EvalAssertion {
  type: AssertionType;
  [key: string]: unknown;
}

export interface EvalCase {
  query_id: string;
  input: { user_message: string };
  reference?: { answer: string };
  assertions?: EvalAssertion[];
  tags?: string[];
}

export interface AssertionResult {
  type: AssertionType;
  verdict: "pass" | "fail" | "skip";
  actual?: unknown;
  reason?: string;
}

export interface CaseResult {
  queryId: string;
  query: string;
  answer: string;
  conversationId: string | null;
  assertions: AssertionResult[];
  errorCode?: string;
}

export interface EvalSetResult {
  agentId: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  cases: CaseResult[];
}

/** Stable id from the user message (deterministic — no clock/random). */
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return `q_${(h >>> 0).toString(36)}`;
}

/** Normalize loosely-shaped query entries into EvalCases. */
export function buildCasesFromQueries(raw: unknown): EvalCase[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { cases?: unknown[] })?.cases)
      ? (raw as { cases: unknown[] }).cases
      : Array.isArray((raw as { queries?: unknown[] })?.queries)
        ? (raw as { queries: unknown[] }).queries
        : [];
  return arr.map((entry) => {
    const e = entry as Record<string, unknown>;
    const userMessage =
      typeof e.query === "string"
        ? e.query
        : typeof (e.input as { user_message?: string } | undefined)?.user_message === "string"
          ? (e.input as { user_message: string }).user_message
          : "";
    const refAnswer = (e.reference as { answer?: string } | undefined)?.answer;
    return {
      query_id: typeof e.query_id === "string" && e.query_id ? e.query_id : hashId(userMessage),
      input: { user_message: userMessage },
      ...(typeof refAnswer === "string" ? { reference: { answer: refAnswer } } : {}),
      ...(Array.isArray(e.assertions) ? { assertions: e.assertions as EvalAssertion[] } : {}),
      ...(Array.isArray(e.tags) ? { tags: e.tags.map(String) } : {}),
    };
  });
}

type Op = "eq" | "lt" | "lte" | "gt" | "gte";
function applyOp(actual: number, op: Op, expected: number): boolean {
  return op === "eq"
    ? actual === expected
    : op === "lt"
      ? actual < expected
      : op === "lte"
        ? actual <= expected
        : op === "gt"
          ? actual > expected
          : actual >= expected;
}
function toolName(s: Span): string {
  const v = s.attributes["gen_ai.tool.name"];
  return typeof v === "string" ? v : s.name;
}
function orderedToolNames(spans: Span[]): string[] {
  return spans
    .filter((s) => s.kind === "tool")
    .slice()
    .sort((a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)))
    .map(toolName);
}
function isSubsequence(seq: string[], actual: string[]): boolean {
  let i = 0;
  for (const n of actual) {
    if (n === seq[i]) i++;
    if (i === seq.length) return true;
  }
  return seq.length === 0;
}

export interface AssertionContext {
  answer: string;
  spans: Span[];
  durationMs?: number;
  reference?: { answer: string };
  /** Judge for semantic_match: returns pass/fail + reasoning. */
  judgeSemanticMatch?: (
    question: string,
    answer: string,
    reference: string,
  ) => Promise<{ verdict: "pass" | "fail"; reasoning: string }>;
}

export async function evaluateAssertion(
  a: EvalAssertion,
  ctx: AssertionContext,
): Promise<AssertionResult> {
  const r = a as Record<string, unknown>;
  switch (a.type) {
    case "contains": {
      const v = String(r.value ?? "");
      return ctx.answer.includes(v)
        ? { type: a.type, verdict: "pass" }
        : { type: a.type, verdict: "fail", actual: ctx.answer };
    }
    case "not_contains": {
      const v = String(r.value ?? "");
      return ctx.answer.includes(v)
        ? { type: a.type, verdict: "fail", actual: ctx.answer }
        : { type: a.type, verdict: "pass" };
    }
    case "regex": {
      let re: RegExp;
      try {
        re = new RegExp(String(r.pattern ?? ""));
      } catch {
        return { type: a.type, verdict: "skip", reason: `invalid regex: ${r.pattern}` };
      }
      return re.test(ctx.answer)
        ? { type: a.type, verdict: "pass" }
        : { type: a.type, verdict: "fail", actual: ctx.answer };
    }
    case "tool_call_count": {
      const count = ctx.spans.filter(
        (s) => s.kind === "tool" && toolName(s) === String(r.tool ?? ""),
      ).length;
      return applyOp(count, (r.op as Op) ?? "eq", Number(r.value ?? 0))
        ? { type: a.type, verdict: "pass", actual: count }
        : { type: a.type, verdict: "fail", actual: count };
    }
    case "tool_call_order": {
      const seq = Array.isArray(r.sequence) ? (r.sequence as unknown[]).map(String) : [];
      const actual = orderedToolNames(ctx.spans);
      return isSubsequence(seq, actual)
        ? { type: a.type, verdict: "pass", actual }
        : { type: a.type, verdict: "fail", actual };
    }
    case "latency_ms": {
      if (ctx.durationMs == null)
        return { type: a.type, verdict: "skip", reason: "durationMs unavailable" };
      return applyOp(ctx.durationMs, (r.op as Op) ?? "lte", Number(r.value ?? 0))
        ? { type: a.type, verdict: "pass", actual: ctx.durationMs }
        : { type: a.type, verdict: "fail", actual: ctx.durationMs };
    }
    case "semantic_match": {
      if (!ctx.judgeSemanticMatch)
        return { type: a.type, verdict: "skip", reason: "no judge (pass --llm)" };
      if (!ctx.reference?.answer)
        return { type: a.type, verdict: "skip", reason: "no reference.answer on case" };
      const smv = await ctx.judgeSemanticMatch(
        String(r.question ?? ""),
        ctx.answer,
        ctx.reference.answer,
      );
      return { type: a.type, verdict: smv.verdict, actual: smv.reasoning };
    }
    default:
      return { type: a.type, verdict: "skip", reason: `unknown assertion type: ${a.type}` };
  }
}

export interface RunEvalSetDeps {
  /** Run one query through the agent → answer + conversation id. */
  runQuery: (query: string) => Promise<{ answer: string; conversationId: string | null }>;
  /** Fetch the spans for a conversation (for assertion evaluation). */
  fetchSpans: (conversationId: string) => Promise<Span[]>;
  judgeSemanticMatch?: AssertionContext["judgeSemanticMatch"];
}

/** Run an eval set: each case → agent run → trace → assertions. */
export async function runEvalSet(
  agentId: string,
  cases: EvalCase[],
  deps: RunEvalSetDeps,
): Promise<EvalSetResult> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const query = c.input.user_message;
    let answer = "";
    let conversationId: string | null = null;
    let spans: Span[] = [];
    let errorCode: string | undefined;
    let chatFailed = false;
    try {
      const run = await deps.runQuery(query);
      answer = run.answer;
      conversationId = run.conversationId;
      if (conversationId) {
        try {
          spans = await deps.fetchSpans(conversationId);
        } catch {
          // Spans unavailable: span-based assertions will fail/skip, but
          // answer-only assertions (contains/regex/semantic_match) still run.
          errorCode = "trace-fetch-failed";
        }
      }
    } catch {
      chatFailed = true;
      errorCode = "chat-failed";
    }
    const assertionResults: AssertionResult[] = [];
    if (!chatFailed) {
      for (const a of c.assertions ?? []) {
        assertionResults.push(
          await evaluateAssertion(a, {
            answer,
            spans,
            reference: c.reference,
            judgeSemanticMatch: deps.judgeSemanticMatch,
          }),
        );
      }
    }
    results.push({
      queryId: c.query_id,
      query,
      answer,
      conversationId,
      assertions: assertionResults,
      ...(errorCode ? { errorCode } : {}),
    });
  }
  const flat = results.flatMap((r) => r.assertions);
  return {
    agentId,
    total: cases.length,
    passed: flat.filter((a) => a.verdict === "pass").length,
    failed: flat.filter((a) => a.verdict === "fail").length,
    skipped: flat.filter((a) => a.verdict === "skip").length,
    cases: results,
  };
}
