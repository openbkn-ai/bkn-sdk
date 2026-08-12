import { describe, expect, it } from "vitest";
import type { RawSpan } from "../../src/api/trace.js";
import { assembleTraceTree, renderReportMarkdown, runRules } from "../../src/bkn-trace/diagnose.js";

let t = 0;
function span(attrs: Record<string, unknown>, over: Partial<RawSpan> = {}): RawSpan {
  t += 1000;
  return {
    spanId: `s${t}`,
    parentSpanId: null,
    name: "span",
    startTimeUnixNano: String(t * 1_000_000),
    endTimeUnixNano: String((t + 1) * 1_000_000),
    attributes: attrs,
    ...over,
  };
}
function diagnose(raw: RawSpan[]) {
  return runRules(assembleTraceTree("trace-1", raw));
}
const toolSpan = (name: string, args: unknown, extra: Record<string, unknown> = {}) =>
  span({
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": name,
    "gen_ai.tool.args": args,
    ...extra,
  });

describe("trace diagnose — symbolic rules", () => {
  it("flags a tool loop with identical args + unchanged state", () => {
    const f = diagnose([
      toolSpan("search", { q: "x" }),
      toolSpan("search", { q: "x" }),
      toolSpan("search", { q: "x" }),
    ]);
    expect(f.some((x) => x.ruleId === "tool_loop_no_state_change")).toBe(true);
    const hit = f.find((x) => x.ruleId === "tool_loop_no_state_change");
    expect(hit?.suggestedFix.change).toContain("search");
    expect(hit?.evidence.spans.length).toBe(3);
  });

  it("does NOT flag a loop when args differ", () => {
    const f = diagnose([
      toolSpan("search", { q: "a" }),
      toolSpan("search", { q: "b" }),
      toolSpan("search", { q: "c" }),
    ]);
    expect(f.some((x) => x.ruleId === "tool_loop_no_state_change")).toBe(false);
  });

  it("flags a swallowed tool error", () => {
    const f = diagnose([
      span(
        {
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": "db",
          "error.message": "boom",
        },
        { status: { code: "ERROR" } },
      ),
      span({ "gen_ai.operation.name": "chat", "gen_ai.prompt": "carry on, all good" }),
    ]);
    expect(f.some((x) => x.ruleId === "tool_error_swallowed")).toBe(true);
  });

  it("does NOT flag when the error is propagated into the next prompt", () => {
    const f = diagnose([
      span(
        {
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": "db",
          "error.message": "boom",
        },
        { status: { code: "ERROR" } },
      ),
      span({ "gen_ai.operation.name": "chat", "gen_ai.prompt": "the tool said: boom" }),
    ]);
    expect(f.some((x) => x.ruleId === "tool_error_swallowed")).toBe(false);
  });

  it("flags empty retrieval with no fallback", () => {
    const f = diagnose([
      span({ "gen_ai.operation.name": "embeddings", "gen_ai.retrieval.result_count": 0 }),
      span({ "gen_ai.operation.name": "chat" }),
    ]);
    expect(f.some((x) => x.ruleId === "retrieval_empty_no_fallback")).toBe(true);
  });

  it("flags a truncated LLM response with no continuation", () => {
    const f = diagnose([
      span({
        "gen_ai.operation.name": "chat",
        "gen_ai.response.finish_reasons": ["length"],
        "gen_ai.conversation.id": "c1",
      }),
    ]);
    expect(f.some((x) => x.ruleId === "llm_response_truncated_no_continue")).toBe(true);
  });

  it("flags excessive tool calls per turn", () => {
    const raw = Array.from({ length: 11 }, (_, i) => toolSpan(`t${i}`, { i }));
    const f = diagnose(raw);
    expect(f.some((x) => x.ruleId === "excessive_tool_calls_per_turn")).toBe(true);
  });

  it("clean trace yields no findings; markdown says so", () => {
    const f = diagnose([span({ "gen_ai.operation.name": "chat" })]);
    expect(f).toEqual([]);
    const md = renderReportMarkdown({
      traceId: "trace-1",
      conversationId: "c1",
      diagnosedAt: null,
      mode: "symbolic-only",
      rulesApplied: [],
      findingCount: 0,
      findings: [],
    });
    expect(md).toContain("No issues found");
  });

  it("renders partial diagnosis coverage instead of claiming no issues", () => {
    const md = renderReportMarkdown({
      traceId: "trace-1",
      conversationId: "c1",
      diagnosedAt: null,
      mode: "symbolic-only",
      rulesApplied: ["excessive_tool_calls_per_turn"],
      skippedRules: ["tool_error_swallowed", "retrieval_empty_no_fallback"],
      partial: true,
      partialReasons: ["typed Trace facts do not contain required attributes"],
      findingCount: 0,
      findings: [],
    });

    expect(md).toContain("Partial coverage");
    expect(md).toContain("tool_error_swallowed");
    expect(md).toContain("typed Trace facts do not contain required attributes");
    expect(md).not.toContain("No issues found");
  });
});
