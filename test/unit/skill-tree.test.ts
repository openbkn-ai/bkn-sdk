import { describe, expect, it } from "vitest";
import type { SkillFileEntry } from "../../src/api/skills.js";
import { classifyPath, filesUnder, listChildren, renderTree } from "../../src/utils/skill-tree.js";

/** Mirrors the manifest shape the backend returns for a two-level skill. */
const FILES: SkillFileEntry[] = [
  { rel_path: "SKILL.md", file_type: "reference", size: 3232, mime_type: "text/markdown" },
  { rel_path: "references/checklist.md", file_type: "reference", size: 845 },
  { rel_path: "references/layouts/dashboard.md", file_type: "reference", size: 1143 },
  { rel_path: "references/layouts/landing.md", file_type: "reference", size: 1150 },
  { rel_path: "scripts/generate_page.py", file_type: "script", size: 7377 },
  { rel_path: "styles/brutalist/tokens.json", file_type: "config", size: 790 },
];

describe("classifyPath", () => {
  it("tells directories, files and misses apart", () => {
    expect(classifyPath(FILES, undefined)).toBe("root");
    expect(classifyPath(FILES, "")).toBe("root");
    expect(classifyPath(FILES, "references")).toBe("dir");
    expect(classifyPath(FILES, "references/layouts")).toBe("dir");
    expect(classifyPath(FILES, "SKILL.md")).toBe("file");
    expect(classifyPath(FILES, "references/checklist.md")).toBe("file");
    expect(classifyPath(FILES, "nope")).toBe("missing");
  });

  it("ignores surrounding slashes", () => {
    expect(classifyPath(FILES, "/references/")).toBe("dir");
  });

  it("does not treat a name prefix as a directory", () => {
    expect(classifyPath(FILES, "ref")).toBe("missing");
  });
});

describe("listChildren", () => {
  it("returns one level, directories first", () => {
    expect(listChildren(FILES).map((c) => `${c.name}:${c.type}`)).toEqual([
      "references:dir",
      "scripts:dir",
      "styles:dir",
      "SKILL.md:file",
    ]);
  });

  it("descends into a directory without recursing further", () => {
    expect(listChildren(FILES, "references").map((c) => `${c.name}:${c.type}`)).toEqual([
      "layouts:dir",
      "checklist.md:file",
    ]);
    expect(listChildren(FILES, "references/layouts").map((c) => c.name)).toEqual([
      "dashboard.md",
      "landing.md",
    ]);
  });

  it("aggregates file counts and bytes onto directory rows", () => {
    const refs = listChildren(FILES).find((c) => c.name === "references");
    expect(refs).toMatchObject({ type: "dir", files: 3, size: 845 + 1143 + 1150 });
  });

  it("carries file metadata through", () => {
    const skillMd = listChildren(FILES).find((c) => c.name === "SKILL.md");
    expect(skillMd).toMatchObject({
      type: "file",
      relPath: "SKILL.md",
      fileType: "reference",
      size: 3232,
      mime: "text/markdown",
    });
  });

  it("handles a flat skill", () => {
    const flat: SkillFileEntry[] = [{ rel_path: "SKILL.md", size: 10 }];
    expect(listChildren(flat).map((c) => c.type)).toEqual(["file"]);
  });
});

describe("filesUnder", () => {
  it("collects the whole subtree", () => {
    expect(filesUnder(FILES, "references").map((f) => f.rel_path)).toEqual([
      "references/checklist.md",
      "references/layouts/dashboard.md",
      "references/layouts/landing.md",
    ]);
    expect(filesUnder(FILES)).toHaveLength(FILES.length);
  });
});

describe("renderTree", () => {
  it("renders nesting with the right connectors", () => {
    expect(renderTree(FILES)).toBe(
      [
        "├── references/",
        "│   ├── layouts/",
        "│   │   ├── dashboard.md  (reference, 1143 B)",
        "│   │   └── landing.md  (reference, 1150 B)",
        "│   └── checklist.md  (reference, 845 B)",
        "├── scripts/",
        "│   └── generate_page.py  (script, 7377 B)",
        "├── styles/",
        "│   └── brutalist/",
        "│       └── tokens.json  (config, 790 B)",
        "└── SKILL.md  (reference, 3232 B)",
      ].join("\n"),
    );
  });

  it("emits no stray connectors for a flat skill", () => {
    const flat: SkillFileEntry[] = [
      { rel_path: "SKILL.md", file_type: "reference", size: 10 },
      { rel_path: "notes.md", file_type: "reference", size: 20 },
    ];
    expect(renderTree(flat)).toBe(
      ["├── notes.md  (reference, 20 B)", "└── SKILL.md  (reference, 10 B)"].join("\n"),
    );
  });
});
