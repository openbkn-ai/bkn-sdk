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

  it("rejects a --timeout that is not a positive integer", async () => {
    stubExecute({ exit_code: 0, stdout: "", stderr: "", mocked: false });
    captureStdio();
    // NaN would reach the wire as `timeout: null` and clamp the local abort to
    // 1ms, failing with a message about nothing the user typed.
    await expect(
      cli().parseAsync([...ARGS, "--entry", "run.sh", "--timeout", "abc"], { from: "user" }),
    ).rejects.toThrow(/--timeout must be a positive integer/);
  });

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
