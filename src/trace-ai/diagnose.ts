/**
 * Trace diagnose engine. Fetches a conversation's spans, shapes them into a
 * trace tree, runs deterministic symbolic predicates, and (in hybrid mode) adds
 * gated LLM-judged rubric findings + an LLM synthesized summary. Cross-trace
 * `scan` is the remaining piece (see docs/exec-plans/tech-debt-tracker.md).
 */
import type { RawSpan } from "../api/trace.js";

export type SpanKind = "tool" | "llm" | "retrieval" | "reasoning" | "unknown";

export interface Span {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  durationMs: number;
  status: "ok" | "error" | "unset";
  attributes: Record<string, unknown>;
}

export interface TraceTree {
  traceId: string;
  spans: Span[];
  byKind: Map<SpanKind, Span[]>;
}

export interface Hit {
  evidenceSpans: string[];
  excerpt: string;
  bindings: Record<string, unknown>;
}

export type Predicate = (trace: TraceTree, params: Record<string, unknown>) => Hit[];

export interface Rule {
  id: string;
  severity: "low" | "medium" | "high";
  symptom: string;
  suggestedFix: { target: string; changeTemplate: string };
  predicate: Predicate;
  params: Record<string, unknown>;
}

export interface Finding {
  ruleId: string;
  judgmentKind: "symbolic" | "rubric";
  severity: "low" | "medium" | "high";
  symptom: string;
  evidence: { spans: string[]; excerpt: string };
  suggestedFix: { target: string; change: string };
  confidence?: "low" | "medium" | "high";
}

export interface Summary {
  headline: string;
  primaryRootCause: string | null;
  targetForFix: string | null;
}

export interface DiagnoseReport {
  traceId: string;
  conversationId: string;
  diagnosedAt: string | null;
  mode: "symbolic-only" | "hybrid";
  rulesApplied: string[];
  findingCount: number;
  summary?: Summary;
  findings: Finding[];
}

/** A rubric (LLM-judged) rule, gated on a symbolic rule having fired. */
export interface RubricRule {
  id: string;
  severity: "low" | "medium" | "high";
  symptom: string;
  gatesOn: string;
  judgeQuestion: string;
  suggestedFix: { target: string; changeTemplate: string };
}

// ── trace shaping ────────────────────────────────────────────────────────────

const KIND_MAP: Record<string, SpanKind> = {
  chat: "llm",
  text_completion: "llm",
  embeddings: "retrieval",
  execute_tool: "tool",
  model: "llm",
  llm: "llm",
  tool: "tool",
  retrieval: "retrieval",
  reasoning: "reasoning",
};

function deriveKind(attrs: Record<string, unknown>): SpanKind {
  const op = attrs["gen_ai.operation.name"];
  if (typeof op === "string" && op in KIND_MAP) return KIND_MAP[op] as SpanKind;
  const t = attrs["agent.trace.type"];
  if (typeof t === "string" && t in KIND_MAP) return KIND_MAP[t] as SpanKind;
  return "unknown";
}

function durationMs(start?: string, end?: string): number {
  if (!start || !end) return 0;
  try {
    return Number((BigInt(end) - BigInt(start)) / 1_000_000n);
  } catch {
    return 0;
  }
}

export function assembleTraceTree(traceId: string, raw: RawSpan[]): TraceTree {
  const spans: Span[] = raw.map((r) => {
    const attrs = r.attributes ?? {};
    const code = r.status?.code?.toUpperCase();
    return {
      spanId: r.spanId,
      parentSpanId: r.parentSpanId ?? null,
      name: r.name ?? "",
      kind: deriveKind(attrs),
      startTimeUnixNano: r.startTimeUnixNano ?? "0",
      endTimeUnixNano: r.endTimeUnixNano ?? "0",
      durationMs: durationMs(r.startTimeUnixNano, r.endTimeUnixNano),
      status: code === "OK" ? "ok" : code === "ERROR" ? "error" : "unset",
      attributes: attrs,
    };
  });
  const byKind = new Map<SpanKind, Span[]>();
  for (const s of spans) {
    const arr = byKind.get(s.kind) ?? [];
    arr.push(s);
    byKind.set(s.kind, arr);
  }
  return { traceId, spans, byKind };
}

// ── predicates (ported 1:1 from the builtin rules) ─────────────────────────────

function byStart(spans: Span[]): Span[] {
  return spans
    .slice()
    .sort((a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)));
}
function strAttr(s: Span, key: string): string {
  const v = s.attributes[key];
  return typeof v === "string" ? v : "";
}
function toolName(s: Span): string {
  return strAttr(s, "gen_ai.tool.name") || s.name;
}

const toolLoopNoStateChange: Predicate = (trace, params) => {
  const STATE = "gen_ai.conversation.state";
  const min = (params.min_consecutive as number | undefined) ?? 3;
  const tools = byStart(trace.byKind.get("tool") ?? []);
  const hits: Hit[] = [];
  let i = 0;
  while (i < tools.length) {
    const start = tools[i] as Span;
    const name = toolName(start);
    const args = start.attributes["gen_ai.tool.args"];
    const state = start.attributes[STATE];
    let j = i + 1;
    while (
      j < tools.length &&
      toolName(tools[j] as Span) === name &&
      JSON.stringify((tools[j] as Span).attributes["gen_ai.tool.args"]) === JSON.stringify(args) &&
      (tools[j] as Span).attributes[STATE] === state
    )
      j++;
    const runLen = j - i;
    if (runLen >= min) {
      hits.push({
        evidenceSpans: tools.slice(i, j).map((s) => s.spanId),
        excerpt: `tool '${name}' called ${runLen} times consecutively with identical args; conversation state unchanged`,
        bindings: { tool_name: name, loop_count: runLen, max_count: min - 1 },
      });
    }
    i = j;
  }
  return hits;
};

const toolErrorSwallowed: Predicate = (trace) => {
  const all = byStart(trace.spans);
  const hits: Hit[] = [];
  for (let i = 0; i < all.length; i++) {
    const s = all[i] as Span;
    if (s.kind !== "tool" || s.status !== "error") continue;
    const errMsg = strAttr(s, "error.message");
    let next: Span | undefined;
    for (let j = i + 1; j < all.length; j++) {
      if ((all[j] as Span).kind === "llm") {
        next = all[j] as Span;
        break;
      }
    }
    if (!next) continue;
    const prompt = (strAttr(next, "gen_ai.prompt") || strAttr(next, "llm.prompt")).toLowerCase();
    if (!(errMsg.length > 0 && prompt.includes(errMsg.toLowerCase()))) {
      hits.push({
        evidenceSpans: [s.spanId, next.spanId],
        excerpt: `tool '${toolName(s)}' errored ('${errMsg}') but the next LLM prompt did not propagate the error`,
        bindings: { tool_name: toolName(s), error_message: errMsg },
      });
    }
  }
  return hits;
};

const retrievalEmptyNoFallback: Predicate = (trace) => {
  const ordered = byStart(trace.spans);
  const hits: Hit[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i] as Span;
    if (s.kind !== "retrieval") continue;
    if (s.attributes["gen_ai.retrieval.result_count"] !== 0) continue;
    const next = ordered[i + 1];
    if (next?.kind === "llm") {
      hits.push({
        evidenceSpans: [s.spanId, next.spanId],
        excerpt: "retrieval returned 0 results; next step was LLM generation with no fallback path",
        bindings: {},
      });
    }
  }
  return hits;
};

const llmResponseTruncatedNoContinue: Predicate = (trace) => {
  const finishReason = (s: Span): string => {
    const arr = s.attributes["gen_ai.response.finish_reasons"];
    if (Array.isArray(arr)) {
      for (const r of arr) if (typeof r === "string" && r) return r;
    }
    return strAttr(s, "gen_ai.response.finish_reason") || strAttr(s, "llm.finish_reason");
  };
  const convId = (s: Span): string => strAttr(s, "gen_ai.conversation.id");
  const llms = byStart(trace.byKind.get("llm") ?? []);
  const hits: Hit[] = [];
  for (let i = 0; i < llms.length; i++) {
    const s = llms[i] as Span;
    if (finishReason(s) !== "length") continue;
    const id = convId(s);
    let cont = false;
    for (let j = i + 1; j < llms.length; j++) if (convId(llms[j] as Span) === id) cont = true;
    if (!cont) {
      hits.push({
        evidenceSpans: [s.spanId],
        excerpt: `LLM response truncated (finish_reason=length) with no continuation span in conversation '${id}'`,
        bindings: { conversation_id: id },
      });
    }
  }
  return hits;
};

const excessiveToolCallsPerTurn: Predicate = (trace, params) => {
  const max = (params.max_tool_calls_per_turn as number | undefined) ?? 10;
  const tools = trace.byKind.get("tool") ?? [];
  if (tools.length <= max) return [];
  return [
    {
      evidenceSpans: tools.map((t) => t.spanId),
      excerpt: `tool calls per turn exceeded threshold: ${tools.length} > ${max}`,
      bindings: { count: tools.length, max_calls: max },
    },
  ];
};

// ── builtin rules ──────────────────────────────────────────────────────────

export const BUILTIN_RULES: Rule[] = [
  {
    id: "tool_loop_no_state_change",
    severity: "high",
    symptom: "repeated_tool_call_without_state_change",
    suggestedFix: {
      target: "decision_agent.prompt",
      changeTemplate:
        "add a stop condition after {{loop_count}} equivalent retries of '{{tool_name}}'",
    },
    predicate: toolLoopNoStateChange,
    params: { min_consecutive: 3 },
  },
  {
    id: "tool_error_swallowed",
    severity: "high",
    symptom: "tool_error_not_propagated_to_llm",
    suggestedFix: {
      target: "agent.tool_result_handling",
      changeTemplate: "feed tool errors back into the next LLM prompt",
    },
    predicate: toolErrorSwallowed,
    params: {},
  },
  {
    id: "retrieval_empty_no_fallback",
    severity: "medium",
    symptom: "empty_retrieval_no_fallback",
    suggestedFix: {
      target: "retrieval.fallback",
      changeTemplate: "add a rewrite/alternate-source fallback when retrieval returns 0 results",
    },
    predicate: retrievalEmptyNoFallback,
    params: {},
  },
  {
    id: "llm_response_truncated_no_continue",
    severity: "medium",
    symptom: "truncated_response_no_continuation",
    suggestedFix: {
      target: "llm.max_tokens",
      changeTemplate: "raise max_tokens or add a continuation turn when finish_reason=length",
    },
    predicate: llmResponseTruncatedNoContinue,
    params: {},
  },
  {
    id: "excessive_tool_calls_per_turn",
    severity: "low",
    symptom: "excessive_tool_calls_per_turn",
    suggestedFix: {
      target: "decision_agent.prompt",
      changeTemplate: "cap tool calls per turn at {{max_calls}}",
    },
    predicate: excessiveToolCallsPerTurn,
    params: { max_tool_calls_per_turn: 10 },
  },
];

function applyTemplate(tpl: string, bindings: Record<string, unknown>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(bindings[k] ?? `{{${k}}}`));
}

/** Run all builtin symbolic rules over a trace tree → findings. */
export function runRules(tree: TraceTree, rules: Rule[] = BUILTIN_RULES): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    for (const hit of rule.predicate(tree, rule.params)) {
      findings.push({
        ruleId: rule.id,
        judgmentKind: "symbolic",
        severity: rule.severity,
        symptom: rule.symptom,
        evidence: { spans: hit.evidenceSpans, excerpt: hit.excerpt },
        suggestedFix: {
          target: rule.suggestedFix.target,
          change: applyTemplate(rule.suggestedFix.changeTemplate, hit.bindings),
        },
      });
    }
  }
  return findings;
}

// ── rubric (LLM-judge) pillar ─────────────────────────────────────────────────

export const BUILTIN_RUBRIC_RULES: RubricRule[] = [
  {
    id: "tool_retry_intent_mismatch",
    severity: "high",
    symptom: "repeated_tool_call_without_state_change",
    gatesOn: "tool_loop_no_state_change",
    judgeQuestion:
      "Given the user's intent and the tool retry pattern in this trace, classify why " +
      "the agent kept calling the same tool: a legitimate retry (expecting changed state), " +
      "a stale-results handling failure (results were identical and the agent didn't notice), " +
      "prompt confusion (misinterpreted its own instructions), or other.",
    suggestedFix: {
      target: "decision_agent.prompt",
      changeTemplate:
        "agent retried because of '{{category}}'; address that intent (staleness detection, broaden query, or escalate)",
    },
  },
];

function userIntent(tree: TraceTree): string {
  for (const s of tree.spans) {
    const v = s.attributes["gen_ai.user.message"];
    if (typeof v === "string" && v) return v;
  }
  const firstLlm = byStart(tree.byKind.get("llm") ?? [])[0];
  return firstLlm ? strAttr(firstLlm, "gen_ai.prompt") || strAttr(firstLlm, "llm.prompt") : "";
}

function spanSequence(tree: TraceTree): Array<Record<string, unknown>> {
  return byStart(tree.spans)
    .filter((s) => s.kind === "tool" || s.kind === "llm")
    .map((s) => ({
      span_id: s.spanId,
      kind: s.kind,
      name: s.name,
      status: s.status,
      tool: strAttr(s, "gen_ai.tool.name") || undefined,
      args: s.attributes["gen_ai.tool.args"],
    }));
}

function buildRubricPrompt(rule: RubricRule, tree: TraceTree): string {
  return [
    "You are a trace-diagnosis judge. Answer the question about the agent trace below.",
    "",
    `QUESTION: ${rule.judgeQuestion}`,
    "",
    `USER INTENT: ${userIntent(tree) || "(unknown)"}`,
    "",
    "SPAN SEQUENCE (tool + llm steps, chronological):",
    JSON.stringify(spanSequence(tree), null, 2),
    "",
    "Respond with ONLY a JSON object (no prose, no code fence) of exactly this shape:",
    '{"category": "legitimate_retry|stale_results|prompt_confusion|other", "reasoning": "<one or two sentences>", "severity": "low|medium|high", "confidence": "low|medium|high", "first_violating_step_id": "<span_id>", "evidence_span_ids": ["<span_id>", ...]}',
  ].join("\n");
}

/**
 * Run rubric (LLM-judged) rules whose symbolic gate fired. Each is judged by
 * the local `claude` CLI. A judge error skips that rule (recorded), never
 * aborts the diagnosis.
 */
export async function runRubric(
  tree: TraceTree,
  symbolicFindings: Finding[],
  judge: (prompt: string) => Promise<Record<string, unknown>>,
  rules: RubricRule[] = BUILTIN_RUBRIC_RULES,
): Promise<Finding[]> {
  const fired = new Set(symbolicFindings.map((f) => f.ruleId));
  const out: Finding[] = [];
  for (const rule of rules) {
    if (!fired.has(rule.gatesOn)) continue;
    let judged: Record<string, unknown>;
    try {
      judged = await judge(buildRubricPrompt(rule, tree));
    } catch {
      continue; // skip-on-failure; symbolic findings still stand
    }
    const category = typeof judged.category === "string" ? judged.category : "other";
    const sev = judged.severity;
    const conf = judged.confidence;
    const spans = Array.isArray(judged.evidence_span_ids)
      ? judged.evidence_span_ids.filter((s): s is string => typeof s === "string")
      : [];
    out.push({
      ruleId: rule.id,
      judgmentKind: "rubric",
      severity: sev === "low" || sev === "medium" || sev === "high" ? sev : rule.severity,
      symptom: rule.symptom,
      evidence: { spans, excerpt: typeof judged.reasoning === "string" ? judged.reasoning : "" },
      suggestedFix: {
        target: rule.suggestedFix.target,
        change: applyTemplate(rule.suggestedFix.changeTemplate, { category }),
      },
      ...(conf === "low" || conf === "medium" || conf === "high" ? { confidence: conf } : {}),
    });
  }
  return out;
}

/**
 * Synthesize the findings into a one-line headline + primary root cause via the
 * LLM judge. Returns a template fallback when there are no findings or the judge
 * fails, so a report always has a Summary.
 */
export async function synthesizeFindings(
  findings: Finding[],
  judge: (prompt: string) => Promise<Record<string, unknown>>,
): Promise<Summary> {
  if (findings.length === 0) {
    return {
      headline: "No issues found by the diagnosis rules.",
      primaryRootCause: null,
      targetForFix: null,
    };
  }
  const prompt = [
    "You are a trace-diagnosis synthesizer. Given these findings, write a concise summary.",
    "FINDINGS:",
    JSON.stringify(
      findings.map((f) => ({
        rule: f.ruleId,
        severity: f.severity,
        symptom: f.symptom,
        evidence: f.evidence.excerpt,
        fix: f.suggestedFix,
      })),
      null,
      2,
    ),
    "",
    'Respond with ONLY JSON: {"headline":"<one sentence>","primary_root_cause":"<one sentence or null>","target_for_fix":"<component or null>"}',
  ].join("\n");
  try {
    const out = await judge(prompt);
    return {
      headline: typeof out.headline === "string" ? out.headline : fallbackHeadline(findings),
      primaryRootCause: typeof out.primary_root_cause === "string" ? out.primary_root_cause : null,
      targetForFix: typeof out.target_for_fix === "string" ? out.target_for_fix : null,
    };
  } catch {
    return { headline: fallbackHeadline(findings), primaryRootCause: null, targetForFix: null };
  }
}

function fallbackHeadline(findings: Finding[]): string {
  const high = findings.filter((f) => f.severity === "high").length;
  return `${findings.length} finding(s)${high > 0 ? `, ${high} high-severity` : ""}.`;
}

/** Render a diagnose report as human-readable markdown. */
export function renderReportMarkdown(r: DiagnoseReport): string {
  const lines = [`# Trace Diagnose — \`${r.traceId}\``, ""];
  lines.push(
    `> conversation \`${r.conversationId}\` · mode ${r.mode} · ${r.findingCount} finding(s)`,
    "",
  );
  if (r.summary) {
    lines.push(`**${r.summary.headline}**`, "");
    if (r.summary.primaryRootCause) {
      const tgt = r.summary.targetForFix ? ` (fix target: \`${r.summary.targetForFix}\`)` : "";
      lines.push(`Primary root cause: ${r.summary.primaryRootCause}${tgt}`, "");
    }
  }
  if (r.findings.length === 0) {
    if (!r.summary) lines.push("No issues found by the symbolic rules.");
    return lines.join("\n");
  }
  const order = { high: 0, medium: 1, low: 2 } as const;
  for (const f of r.findings.slice().sort((a, b) => order[a.severity] - order[b.severity])) {
    const conf = f.confidence ? `, confidence ${f.confidence}` : "";
    lines.push(`## [${f.severity.toUpperCase()}] ${f.ruleId} (${f.judgmentKind}${conf})`, "");
    lines.push(`- **symptom**: ${f.symptom}`);
    lines.push(`- **evidence**: ${f.evidence.excerpt}`);
    lines.push(`- **spans**: ${f.evidence.spans.map((s) => `\`${s}\``).join(", ") || "—"}`);
    lines.push(`- **suggested fix** (\`${f.suggestedFix.target}\`): ${f.suggestedFix.change}`, "");
  }
  return lines.join("\n");
}
