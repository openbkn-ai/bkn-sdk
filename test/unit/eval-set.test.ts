import { describe, expect, it } from "vitest";
import type { Span } from "../../src/trace-ai/diagnose.js";
import {
  buildCasesFromQueries,
  evaluateAssertion,
  runEvalSet,
} from "../../src/trace-ai/eval-set.js";

const toolSpan = (name: string, i: number): Span => ({
  spanId: `s${i}`,
  parentSpanId: null,
  name,
  kind: "tool",
  startTimeUnixNano: String(i * 1000),
  endTimeUnixNano: String(i * 1000 + 1),
  durationMs: 1,
  status: "ok",
  attributes: { "gen_ai.tool.name": name },
});

describe("eval-set builder", () => {
  it("normalizes query strings + input shapes, derives stable ids", () => {
    const cases = buildCasesFromQueries([
      { query: "hello" },
      {
        input: { user_message: "world" },
        query_id: "fixed",
        assertions: [{ type: "contains", value: "x" }],
      },
    ]);
    expect(cases[0]?.input.user_message).toBe("hello");
    expect(cases[0]?.query_id).toMatch(/^q_/);
    expect(cases[1]?.query_id).toBe("fixed");
    expect(cases[1]?.assertions?.length).toBe(1);
    // deterministic id
    expect(buildCasesFromQueries([{ query: "hello" }])[0]?.query_id).toBe(cases[0]?.query_id);
  });
  it("reads {cases:[...]} and {queries:[...]} wrappers", () => {
    expect(buildCasesFromQueries({ cases: [{ query: "a" }] }).length).toBe(1);
    expect(buildCasesFromQueries({ queries: [{ query: "b" }] }).length).toBe(1);
  });
});

describe("eval-set assertions", () => {
  const ctx = {
    answer: "the refund window is 30 days",
    spans: [toolSpan("search", 1), toolSpan("search", 2)],
  };
  it("contains / not_contains", async () => {
    expect((await evaluateAssertion({ type: "contains", value: "refund" }, ctx)).verdict).toBe(
      "pass",
    );
    expect((await evaluateAssertion({ type: "contains", value: "nope" }, ctx)).verdict).toBe(
      "fail",
    );
    expect((await evaluateAssertion({ type: "not_contains", value: "nope" }, ctx)).verdict).toBe(
      "pass",
    );
  });
  it("regex", async () => {
    expect((await evaluateAssertion({ type: "regex", pattern: "\\d+ days" }, ctx)).verdict).toBe(
      "pass",
    );
    expect((await evaluateAssertion({ type: "regex", pattern: "(" }, ctx)).verdict).toBe("skip");
  });
  it("tool_call_count with op", async () => {
    expect(
      (
        await evaluateAssertion(
          { type: "tool_call_count", tool: "search", op: "eq", value: 2 },
          ctx,
        )
      ).verdict,
    ).toBe("pass");
    expect(
      (
        await evaluateAssertion(
          { type: "tool_call_count", tool: "search", op: "lt", value: 2 },
          ctx,
        )
      ).verdict,
    ).toBe("fail");
  });
  it("tool_call_order subsequence", async () => {
    expect(
      (await evaluateAssertion({ type: "tool_call_order", sequence: ["search"] }, ctx)).verdict,
    ).toBe("pass");
    expect(
      (await evaluateAssertion({ type: "tool_call_order", sequence: ["other"] }, ctx)).verdict,
    ).toBe("fail");
  });
  it("semantic_match skips without judge / reference", async () => {
    expect((await evaluateAssertion({ type: "semantic_match" }, ctx)).verdict).toBe("skip");
  });
  it("semantic_match uses the judge when present", async () => {
    const r = await evaluateAssertion(
      { type: "semantic_match", question: "same meaning?" },
      {
        ...ctx,
        reference: { answer: "30-day refunds" },
        judgeSemanticMatch: async () => ({ verdict: "pass", reasoning: "match" }),
      },
    );
    expect(r.verdict).toBe("pass");
    expect(r.actual).toBe("match");
  });
});

describe("runEvalSet", () => {
  it("runs each case through the agent + asserts, tallies verdicts", async () => {
    const cases = buildCasesFromQueries([
      { query: "refund?", assertions: [{ type: "contains", value: "30 days" }] },
      { query: "broken?", assertions: [{ type: "contains", value: "never" }] },
    ]);
    const res = await runEvalSet("agent-1", cases, {
      runQuery: async (q) => ({ answer: q === "refund?" ? "30 days" : "ok", conversationId: "c1" }),
      fetchSpans: async () => [],
    });
    expect(res.total).toBe(2);
    expect(res.passed).toBe(1);
    expect(res.failed).toBe(1);
  });
  it("records chat-failed without throwing", async () => {
    const cases = buildCasesFromQueries([
      { query: "x", assertions: [{ type: "contains", value: "y" }] },
    ]);
    const res = await runEvalSet("a", cases, {
      runQuery: async () => {
        throw new Error("boom");
      },
      fetchSpans: async () => [],
    });
    expect(res.cases[0]?.errorCode).toBe("chat-failed");
    expect(res.cases[0]?.assertions.length).toBe(0);
  });
});
