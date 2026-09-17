import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { skillCommand } from "../../src/commands/skill.js";
import { toolCallFailed, toolCommand, toolboxCommand } from "../../src/commands/toolbox.js";
import { writeVersionCheckCache } from "../../src/config/store.js";

const BASE = "https://demo.example.com";

/** Root with the global flags the commands read through `optsWithGlobals`. */
function cli(): Command {
  const root = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <t>")
    .option("--json");
  for (const c of [skillCommand(), toolboxCommand(), toolCommand()]) {
    c.exitOverride();
    for (const sub of c.commands) sub.exitOverride();
    root.addCommand(c);
  }
  return root;
}

function run(...args: string[]) {
  return cli().parseAsync(["--base-url", BASE, "--token", "t", ...args], { from: "user" });
}

type CallArgs = [string, RequestInit];
function stubFetch(): { calls: CallArgs[] } {
  const fn = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn.mock as unknown as { calls: CallArgs[] };
}
const query = (m: { calls: CallArgs[] }) =>
  Object.fromEntries(new URL((m.calls[0] as CallArgs)[0]).searchParams);

beforeEach(() => {
  writeVersionCheckCache(BASE, { serverVersion: "0.1.5", checkedAt: new Date().toISOString() });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("toolbox list", () => {
  it("sends page/page_size and the documented filters", async () => {
    const m = stubFetch();
    await run(
      "toolbox",
      "list",
      "--name",
      "orders",
      "--status",
      "published",
      "--metadata-type",
      "function",
      "--sort-by",
      "name",
      "--limit",
      "100",
      "--page",
      "2",
    );
    expect(query(m)).toEqual({
      name: "orders",
      status: "published",
      metadata_type: "function",
      sort_by: "name",
      page_size: "100",
      page: "2",
    });
  });

  it("keeps --keyword as an alias of --name", async () => {
    const m = stubFetch();
    await run("toolbox", "list", "--keyword", "orders");
    expect(query(m)).toMatchObject({ name: "orders", page_size: "30", page: "1" });
    expect(query(m)).not.toHaveProperty("keyword");
  });

  it("refuses --offset rather than silently returning page 1", async () => {
    const m = stubFetch();
    await expect(run("toolbox", "list", "--offset", "30")).rejects.toThrow(/--page/);
    expect(m.calls).toHaveLength(0);
  });

  it.each([
    ["--limit", "101"],
    ["--limit", "0"],
    ["--status", "draft"],
    ["--page", "x"],
  ])("rejects %s %s before sending", async (flag, value) => {
    const m = stubFetch();
    await expect(run("toolbox", "list", flag, value)).rejects.toThrow(flag);
    expect(m.calls).toHaveLength(0);
  });
});

describe("toolbox unpublish / import", () => {
  it("unpublish takes the box offline", async () => {
    const m = stubFetch();
    await run("toolbox", "unpublish", "b1");
    expect(JSON.parse(String((m.calls[0] as CallArgs)[1].body))).toEqual({ status: "offline" });
  });

  it("import --mode upsert sends mode", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "impex-cmd-")), "box.adp");
    writeFileSync(file, "{}");
    const m = stubFetch();
    await run("toolbox", "import", file, "--mode", "upsert");
    expect(((m.calls[0] as CallArgs)[1].body as FormData).get("mode")).toBe("upsert");
    await expect(run("toolbox", "import", file, "--mode", "replace")).rejects.toThrow(/--mode/);
  });
});

describe("tool list", () => {
  it("forwards name/status/sort/user filters", async () => {
    const m = stubFetch();
    await run(
      "tool",
      "list",
      "--toolbox",
      "b1",
      "--name",
      "add",
      "--status",
      "disabled",
      "--sort-by",
      "tool_name",
      "--sort-order",
      "asc",
      "--user-id",
      "u1",
    );
    expect(query(m)).toEqual({
      name: "add",
      status: "disabled",
      sort_by: "tool_name",
      sort_order: "asc",
      user_id: "u1",
    });
  });
});

describe("skill list / market / set-status", () => {
  it("list sends --category, not source", async () => {
    const m = stubFetch();
    await run("skill", "list", "--category", "data", "--status", "offline", "--all");
    expect(query(m)).toEqual({
      page: "1",
      page_size: "30",
      category: "data",
      status: "offline",
      all: "true",
    });
  });

  it("--source is gone from list and --status from market", async () => {
    stubFetch();
    await expect(run("skill", "list", "--source", "custom")).rejects.toThrow(/unknown option/);
    await expect(run("skill", "market", "--status", "published")).rejects.toThrow(/unknown option/);
  });

  it.each(["unpublish", "editing", "draft"])(
    "set-status refuses %s, which the endpoint does not accept",
    async (status) => {
      const m = stubFetch();
      await expect(run("skill", "set-status", "s1", status)).rejects.toThrow(
        /published \| offline/,
      );
      expect(m.calls).toHaveLength(0);
    },
  );

  it("set-status sends offline", async () => {
    const m = stubFetch();
    await run("skill", "set-status", "s1", "offline");
    expect(JSON.parse(String((m.calls[0] as CallArgs)[1].body))).toEqual({ status: "offline" });
  });
});

describe("tool execute exit status", () => {
  it("treats an envelope carrying an upstream failure as failed", () => {
    expect(toolCallFailed({ status_code: 500, error: "context deadline exceeded" })).toBe(true);
    expect(toolCallFailed({ status_code: 404, body: {} })).toBe(true);
    expect(toolCallFailed({ status_code: 200, error: "boom" })).toBe(true);
    expect(toolCallFailed({ status_code: 200, error: "", body: { result: 3 } })).toBe(false);
    expect(toolCallFailed({ status_code: 200, error: null, body: { result: 3 } })).toBe(false);
    expect(toolCallFailed(null)).toBe(false);
  });

  it("sets a non-zero exit code when the proxy reports a failed call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status_code: 500, error: "deadline exceeded" }), {
            status: 200,
          }),
      ),
    );
    const previous = process.exitCode;
    try {
      await run("tool", "execute", "t1", "--toolbox", "b1");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previous;
    }
  });
});
