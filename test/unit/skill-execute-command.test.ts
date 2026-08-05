import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skillCommand } from "../../src/commands/skill.js";

/** Root with the global flags the skill commands read through `optsWithGlobals`. */
function cli(): Command {
  const root = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <t>")
    .option("--json");
  root.addCommand(skillCommand());
  return root;
}

function stubExecute(result: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(result), { status: 200 })),
  );
}

function captureStdio() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    out.push(String(s));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    err.push(String(s));
    return true;
  });
  return { out, err };
}

const ARGS = ["--base-url", "https://demo.example.com", "--token", "t", "skill", "execute", "s1"];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("skill execute", () => {
  it("splits stdout and stderr under --raw", async () => {
    stubExecute({ exit_code: 0, stdout: "hello\n", stderr: "note\n", mocked: false });
    const { out, err } = captureStdio();
    await cli().parseAsync([...ARGS, "--entry", "run.sh", "--raw"], { from: "user" });
    expect(out.join("")).toBe("hello\n");
    expect(err.join("")).toBe("note\n");
  });

  it("maps the sandbox exit code only when asked", async () => {
    stubExecute({ exit_code: 3, stdout: "", stderr: "", mocked: false });
    captureStdio();
    await cli().parseAsync([...ARGS, "--entry", "boom.sh", "--raw"], { from: "user" });
    expect(process.exitCode).toBeUndefined();

    await cli().parseAsync([...ARGS, "--entry", "boom.sh", "--raw", "--exit-code"], {
      from: "user",
    });
    expect(process.exitCode).toBe(3);
  });

  it.each(["abc", "1e3", "3.9", "30abc", "-5", "0"])(
    "rejects --timeout %s rather than silently using a different limit",
    async (bad) => {
      stubExecute({ exit_code: 0, stdout: "", stderr: "", mocked: false });
      captureStdio();
      // `parseInt` stops at the first non-digit, so `1e3` would quietly become
      // a 1-second limit — worse than an error.
      await expect(
        cli().parseAsync([...ARGS, "--entry", "run.sh", "--timeout", bad], { from: "user" }),
      ).rejects.toThrow(/--timeout must be a positive integer/);
    },
  );

  it("omits timeout entirely when the flag is absent", async () => {
    stubExecute({ exit_code: 0, stdout: "", stderr: "", mocked: false });
    captureStdio();
    await cli().parseAsync([...ARGS, "--entry", "run.sh", "--raw"], { from: "user" });
    const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] as [string, RequestInit];
    // A CLI-side default would pin every run to our number instead of the
    // sandbox's.
    expect(JSON.parse(init.body as string)).toEqual({ entry_shell: "run.sh" });
  });

  it("fails the shell when the sandbox only mocked the run", async () => {
    stubExecute({ exit_code: 0, stdout: "", stderr: "", mocked: true });
    captureStdio();
    // `skill execute … --exit-code && deploy` must not proceed on a run that
    // never happened.
    await cli().parseAsync([...ARGS, "--entry", "run.sh", "--raw", "--exit-code"], {
      from: "user",
    });
    expect(process.exitCode).toBe(125);
  });

  it("does not let an out-of-range exit code truncate to success", async () => {
    stubExecute({ exit_code: 256, stdout: "", stderr: "", mocked: false });
    captureStdio();
    await cli().parseAsync([...ARGS, "--entry", "boom.sh", "--raw", "--exit-code"], {
      from: "user",
    });
    expect(process.exitCode).toBe(1);
  });

  it("warns on stderr when the sandbox only mocked the run", async () => {
    stubExecute({ exit_code: 0, stdout: "fake\n", stderr: "", mocked: true });
    const { out, err } = captureStdio();
    await cli().parseAsync([...ARGS, "--entry", "run.sh", "--raw"], { from: "user" });
    // The warning must not land in stdout, which callers redirect into files.
    expect(err.join("")).toMatch(/mocked=true/);
    expect(out.join("")).toBe("fake\n");
  });
});

describe("skill files --tree", () => {
  const MANIFEST = [
    { rel_path: "SKILL.md", file_type: "reference", size: 10 },
    { rel_path: "references/checklist.md", file_type: "reference", size: 20 },
    { rel_path: "references/layouts/landing.md", file_type: "reference", size: 30 },
    { rel_path: "scripts/gen.py", file_type: "script", size: 40 },
  ];

  function stubManifest() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ files: MANIFEST }), { status: 200 })),
    );
  }

  const TREE_ARGS = ["--base-url", "https://demo.example.com", "--token", "t", "skill", "files"];

  it("narrows the tree to the given path", async () => {
    stubManifest();
    const { out } = captureStdio();
    await cli().parseAsync([...TREE_ARGS, "s1", "references", "--tree"], { from: "user" });
    const text = out.join("");
    // The wiring is what regressed before: the pure helpers were always right,
    // `--tree` just never called them with `path`.
    expect(text).toContain("checklist.md");
    expect(text).toContain("landing.md");
    expect(text).not.toContain("gen.py");
    expect(text).not.toContain("SKILL.md");
    expect(text).toMatch(/2 files, 50 B/);
  });

  it("renders the whole skill when no path is given", async () => {
    stubManifest();
    const { out } = captureStdio();
    await cli().parseAsync([...TREE_ARGS, "s1", "--tree"], { from: "user" });
    expect(out.join("")).toMatch(/4 files, 100 B/);
  });

  it("refuses a file path instead of rendering the whole manifest", async () => {
    stubManifest();
    captureStdio();
    await expect(
      cli().parseAsync([...TREE_ARGS, "s1", "SKILL.md", "--tree"], { from: "user" }),
    ).rejects.toThrow(/is a file/);
  });

  it("refuses a path that is not in the skill", async () => {
    stubManifest();
    captureStdio();
    await expect(
      cli().parseAsync([...TREE_ARGS, "s1", "nope", "--tree"], { from: "user" }),
    ).rejects.toThrow(/not found in skill/);
  });
});
