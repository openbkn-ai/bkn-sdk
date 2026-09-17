import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createTool, tools, setToolStatus, generate } = vi.hoisted(() => ({
  generate: vi.fn(async () => ({ content: "def handler(event): ..." })),
  createTool: vi.fn(async () => ({ success_ids: ["tool-1"] })),
  tools: vi.fn(async () => ({ entries: [], total_count: 0 })),
  setToolStatus: vi.fn(async () => undefined),
}));

vi.mock("../../src/commands/_shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/commands/_shared.js")>();
  return {
    ...actual,
    clientFrom: vi.fn(() => ({
      toolboxes: { createTool, tools, setToolStatus },
      functions: { generate },
    })),
  };
});

import { buildProgram } from "../../src/cli-program.js";
import { describeCommandTree } from "../../src/commands/describe.js";
import { sandboxCommand } from "../../src/commands/function.js";
import {
  apiToolCommand,
  functionToolCommand,
  toolCommand,
  toolboxCommand,
} from "../../src/commands/toolbox.js";
import { guideOf } from "../../src/help/grouped-help.js";

let dir = "";

function file(name: string, contents: string): string {
  if (!dir) dir = mkdtempSync(join(tmpdir(), "bkn-capability-command-"));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

function run(command: Command, ...argv: string[]): Promise<Command> {
  return new Command("openbkn")
    .exitOverride()
    .option("--json")
    .option("--compact")
    .addCommand(command)
    .parseAsync(["node", "openbkn", "--json", ...argv]);
}

afterEach(() => {
  vi.clearAllMocks();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("typed execution capability commands", () => {
  it("registers Function Tool code with the fixed function metadata type", async () => {
    const code = file("add.py", "def handler(event):\n    return event\n");
    await run(
      functionToolCommand(),
      "function",
      "create",
      code,
      "--toolbox",
      "box-1",
      "--name",
      "add",
    );

    expect(createTool).toHaveBeenCalledWith(
      "box-1",
      expect.objectContaining({
        metadataType: "function",
        function: expect.objectContaining({
          name: "add",
          code: expect.stringContaining("handler"),
        }),
      }),
    );
  });

  it("imports an OpenAPI document with the fixed openapi metadata type", async () => {
    const spec = file(
      "orders.yaml",
      "openapi: 3.0.0\ninfo:\n  title: Orders\n  version: 1.0.0\npaths: {}\n",
    );
    await run(apiToolCommand(), "api", "import", spec, "--toolbox", "box-2");

    expect(createTool).toHaveBeenCalledWith(
      "box-2",
      expect.objectContaining({
        metadataType: "openapi",
        data: expect.objectContaining({ openapi: "3.0.0" }),
      }),
    );
  });

  it("does not expose the ambiguous type selector in a typed facade", () => {
    const functionCreate = functionToolCommand().commands.find(
      (command) => command.name() === "create",
    );
    const apiImport = apiToolCommand().commands.find((command) => command.name() === "import");

    expect(functionCreate?.options.some((option) => option.long === "--type")).toBe(false);
    expect(apiImport?.options.some((option) => option.long === "--type")).toBe(false);
  });

  it("separates sandbox iteration from registered Function Tools in the root tree", () => {
    const commands = buildProgram().commands;
    const sandbox = commands.find((command) => command.name() === "sandbox");
    const functionTools = commands.find((command) => command.name() === "function");
    const api = commands.find((command) => command.name() === "api");

    expect(sandbox?.commands.map((command) => command.name())).toContain("run");
    expect(sandbox?.commands.map((command) => command.name())).toContain("generate");
    expect(functionTools?.commands.map((command) => command.name())).toContain("create");
    expect(functionTools?.commands.map((command) => command.name())).not.toContain("run");
    expect(api?.commands.map((command) => command.name())).toContain("import");
  });

  it("points typed tool ids back to the matching typed list in describe output", () => {
    const tree = describeCommandTree(buildProgram()) as {
      commands: Array<{
        path: string;
        commands?: Array<{ path: string; arguments?: Array<{ from?: string }> }>;
      }>;
    };
    const functionGet = tree.commands
      .find((command) => command.path === "function")
      ?.commands?.find((command) => command.path === "function get");
    const apiGet = tree.commands
      .find((command) => command.path === "api")
      ?.commands?.find((command) => command.path === "api get");

    expect(functionGet?.arguments?.[0]?.from).toBe("openbkn function list --toolbox <box-id>");
    expect(apiGet?.arguments?.[0]?.from).toBe("openbkn api list --toolbox <box-id>");
  });

  it("hides code-only flags on spec-backed api commands", () => {
    const longs = (group: Command, name: string) =>
      group.commands.find((command) => command.name() === name)?.options.map((o) => o.long) ?? [];
    const codeOnly = ["--inputs", "--outputs", "--dep", "--index-url"];

    const apiImport = longs(apiToolCommand(), "import");
    for (const flag of [...codeOnly, "--name", "--description"]) {
      expect(apiImport).not.toContain(flag);
    }
    const apiUpdate = longs(apiToolCommand(), "update");
    for (const flag of codeOnly) expect(apiUpdate).not.toContain(flag);
    expect(apiUpdate).toEqual(expect.arrayContaining(["--name", "--description"]));

    const functionCreate = longs(functionToolCommand(), "create");
    expect(functionCreate).toEqual(expect.arrayContaining([...codeOnly, "--name"]));
    const toolCreate = longs(toolCommand(), "create");
    expect(toolCreate).toEqual(expect.arrayContaining([...codeOnly, "--name", "--type"]));
  });

  it("still requires --name and --description on api update", async () => {
    const spec = file("orders.yaml", "openapi: 3.0.0\npaths: {}\n");
    await expect(
      run(apiToolCommand(), "api", "update", "tool-1", spec, "--toolbox", "box-2"),
    ).rejects.toThrow(/--name and --description are required/);
  });

  it("passes sandbox generate --timeout to the SDK in milliseconds", async () => {
    await run(
      sandboxCommand(),
      "sandbox",
      "generate",
      "python_function_generator",
      "--query",
      "add",
      "--timeout",
      "120",
    );
    expect(generate).toHaveBeenCalledWith(
      "python_function_generator",
      expect.objectContaining({ query: "add" }),
      { timeoutMs: 120_000 },
    );
  });

  it("leaves the generation budget to the SDK default when --timeout is absent", async () => {
    await run(
      sandboxCommand(),
      "sandbox",
      "generate",
      "python_function_generator",
      "--query",
      "add",
    );
    expect(generate).toHaveBeenCalledWith("python_function_generator", expect.anything(), {});
  });

  it("teaches publish before execute everywhere a workflow is spelled out", () => {
    const guides = [
      guideOf(functionToolCommand()),
      guideOf(apiToolCommand()),
      guideOf(toolboxCommand()),
      guideOf(sandboxCommand()),
      guideOf(buildProgram()),
    ];
    for (const text of guides) {
      expect(text).toBeDefined();
      const publish = text?.indexOf("toolbox publish") ?? -1;
      const execute = text?.search(/(function|api|tool) execute/) ?? -1;
      expect(publish).toBeGreaterThan(-1);
      expect(execute).toBeGreaterThan(publish);
      expect(text).not.toMatch(/market/i);
    }
    expect(guideOf(functionToolCommand())).toContain("ToolNotAvailable");
    expect(guideOf(functionToolCommand())).toContain("sandbox run");
  });
});
