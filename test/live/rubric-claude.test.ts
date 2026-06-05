import { describe, expect, it } from "vitest";
import type { RawSpan } from "../../src/api/trace.js";
import { claudeAvailable, judgeJson } from "../../src/trace-ai/claude-judge.js";
import {
  assembleTraceTree,
  runRubric,
  runRules,
  synthesizeFindings,
} from "../../src/trace-ai/diagnose.js";

// Live: hits the local `claude` CLI. Gated — only runs with BKN_JUDGE_LIVE=1.
const live = process.env.BKN_JUDGE_LIVE === "1";

(live ? describe : describe.skip)("trace rubric via local claude", () => {
  it("judges a tool-loop trace into a rubric finding", async () => {
    expect(claudeAvailable()).toBe(true);
    const mk = (i: number): RawSpan => ({
      spanId: `s${i}`,
      parentSpanId: null,
      name: "search",
      startTimeUnixNano: String(i * 1_000_000_000),
      endTimeUnixNano: String(i * 1_000_000_000 + 1000),
      attributes: {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "search_docs",
        "gen_ai.tool.args": { q: "refund policy" },
        "gen_ai.user.message": "how do I get a refund?",
      },
    });
    const tree = assembleTraceTree("t1", [mk(1), mk(2), mk(3), mk(4)]);
    const sym = runRules(tree);
    expect(sym.some((f) => f.ruleId === "tool_loop_no_state_change")).toBe(true);
    const rubric = await runRubric(tree, sym, (p) => judgeJson(p, { timeoutMs: 120_000 }));
    expect(rubric.length).toBe(1);
    expect(rubric[0]?.judgmentKind).toBe("rubric");
    expect(rubric[0]?.evidence.excerpt.length).toBeGreaterThan(0);
    console.log("rubric finding:", JSON.stringify(rubric[0], null, 2));

    const summary = await synthesizeFindings([...sym, ...rubric], (p) =>
      judgeJson(p, { timeoutMs: 120_000 }),
    );
    expect(summary.headline.length).toBeGreaterThan(0);
    console.log("summary:", JSON.stringify(summary, null, 2));
  }, 180_000);
});
