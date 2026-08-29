import { describe, expect, it } from "vitest";

import { buildProgram } from "../../src/cli-program.js";
import { describeCommandTree } from "../../src/commands/describe.js";

/**
 * The help is a product surface an agent reads before it can do anything, and
 * it lives in template literals that a stray backtick can break. These pin the
 * parts a reader depends on: the vocabulary, that every command carries it, and
 * that the machine-readable view agrees with the prose one.
 */
const SECTIONS = ["GROUPS", "READ", "RUN", "WRITE"];

interface Described {
  path: string;
  section: string;
  summary: string;
  /** Absent on a leaf, which is why the walk has to tolerate it. */
  commands?: Described[];
}

function flatten(cmds: Described[]): Described[] {
  return cmds.flatMap((c) => [c, ...flatten(c.commands ?? [])]);
}

function tree() {
  return describeCommandTree(buildProgram()) as {
    sections: Record<string, string>;
    guide: string;
    commands: Described[];
  };
}

describe("root help", () => {
  it("explains the section vocabulary it sorts every group by", () => {
    const guide = tree().guide;
    for (const section of SECTIONS) expect(guide).toContain(section);
    // The reader needs the point of the split, not just the words.
    expect(guide).toContain("confirm those");
  });

  it("tells a first-time caller how to start and where to look a path up", () => {
    const guide = tree().guide;
    expect(guide).toContain("openbkn auth login");
    expect(guide).toContain("https://openbkn-ai.github.io/bkn-foundry/");
  });
});

describe("command tree", () => {
  it("sorts every command into a section", () => {
    const unsorted = flatten(tree().commands).filter((c) => !SECTIONS.includes(c.section));
    // Top-level commands carry the root's own task-shaped sections instead.
    const nested = unsorted.filter((c) => c.path.includes(" "));
    expect(nested.map((c) => `${c.path} → ${c.section}`)).toEqual([]);
  });

  it("gives every command a summary", () => {
    const silent = flatten(tree().commands).filter((c) => !c.summary.trim());
    expect(silent.map((c) => c.path)).toEqual([]);
  });

  it("ships the meaning of each section, not just its name", () => {
    const { sections } = tree();
    for (const section of SECTIONS) {
      expect(sections[section]?.length ?? 0).toBeGreaterThan(10);
    }
  });
});
