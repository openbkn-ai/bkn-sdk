import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("OpenBKN third-party Agent contract", () => {
  it("keeps the managed lifecycle gate concise in the first partial read", async () => {
    const skill = await readFile(new URL("../../skills/openbkn/SKILL.md", import.meta.url), "utf8");
    const first80Lines = skill.split("\n").slice(0, 80).join("\n");
    const gate = first80Lines.match(
      /## 第三方 Agent 业务问答硬门禁\n\n([\s\S]*?)\n\n详细合同/,
    )?.[1];

    expect(gate).toBeDefined();
    expect(gate?.split("\n")).toHaveLength(5);
    expect(first80Lines).toContain("业务问答必须受管");
    expect(first80Lines).toContain("不得虚构");
    expect(first80Lines).toContain("不得降级");
    expect(first80Lines).toContain("bkn_start_interaction");
    expect(first80Lines).toContain("bkn_finish_interaction");
    expect(first80Lines).toContain("提交本轮结果");
    expect(first80Lines).toContain("不关闭 Conversation");
    expect(first80Lines).toContain("首轮");
    expect(first80Lines).not.toContain("claims");
    expect(first80Lines).not.toContain("bkn_ensure_conversation");
    expect(first80Lines).not.toContain("external_conversation_key");
    expect(first80Lines).not.toContain("lease_token");
    expect(first80Lines).not.toContain("bkn_complete_interaction");
  });

  it("keeps create-skill metric guidance on Object Metric V1", async () => {
    const sources = await Promise.all([
      readFile(
        new URL("../../skills/create-skill/assets/templates/SKILL.md.template", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../skills/create-skill/assets/templates/function.py.template", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../../skills/create-skill/references/examples/demand-deliverability-assessment/SKILL.md",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
    const guidance = sources.join("\n");

    expect(guidance).toContain("query.time={start,end}");
    expect(guidance).toContain("query.group_by");
    expect(guidance).toContain("entries[].value");
    expect(guidance).not.toContain("time.instant");
    expect(guidance).not.toContain("datas[0].values[0]");
  });
});
