// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn function …` — run code in the platform sandbox, before it is anything. */
import { readFileSync } from "node:fs";
import { Command } from "commander";
import type { DependencyInfo, FunctionDefinition, ParameterDef } from "../api/functions.js";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

/** Code from a path, or from stdin when the path is `-`. */
export function readCode(file: string): string {
  try {
    return readFileSync(file === "-" ? 0 : file, "utf8");
  } catch (err) {
    throw new InputError(
      `Cannot read ${file === "-" ? "stdin" : file}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/** `--dep requests@2.32.3`, repeatable; the version is optional. */
export function collectDep(value: string, previous: DependencyInfo[] = []): DependencyInfo[] {
  const at = value.lastIndexOf("@");
  const name = at > 0 ? value.slice(0, at) : value;
  const version = at > 0 ? value.slice(at + 1) : undefined;
  if (!name) throw new InputError("--dep takes <name> or <name>@<version>");
  return [...previous, version ? { name, version } : { name }];
}

export function parseJsonOption(raw: string | undefined, label: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return parseBigIntJSON(raw);
  } catch {
    throw new InputError(`--${label} must be valid JSON`);
  }
}

/**
 * The flags that describe a function. An operator and a tool are described the
 * same way, so a caller learns them once: `openbkn function` iterates on the
 * code, `operator register` and `tool create` keep it, all with these names.
 */
export interface CodeFlags {
  name?: string;
  description?: string;
  type?: string;
  inputs?: string;
  outputs?: string;
  dep?: DependencyInfo[];
  indexUrl?: string;
}

export function definitionFlags(c: Command): Command {
  return c
    .option("--name <n>", "name; required when the definition is a function")
    .option("--description <d>", "what it does — the model reads this to decide when to call it")
    .option("--type <t>", "function | openapi", "function")
    .option("--inputs <json>", "input parameters: [{name,type,required,description}]")
    .option("--outputs <json>", "output parameters, same shape as --inputs")
    .option("--dep <name@version>", "package to install before running (repeatable)", collectDep)
    .option("--index-url <url>", "package index to install from");
}

/** `--inputs` / `--outputs`, parsed and checked for shape. */
export function parameterList(raw: string | undefined, label: string): ParameterDef[] | undefined {
  const parsed = parseJsonOption(raw, label);
  if (parsed === undefined) return undefined;
  if (!Array.isArray(parsed)) throw new InputError(`--${label} must be a JSON array of parameters`);
  return parsed as ParameterDef[];
}

/** A function definition from a code file plus the shared flags. */
export function functionDefinitionFrom(file: string, opts: CodeFlags): FunctionDefinition {
  if (!opts.name) throw new InputError("--name is required for a function");
  return {
    name: opts.name,
    description: opts.description,
    code: readCode(file),
    inputs: parameterList(opts.inputs, "inputs"),
    outputs: parameterList(opts.outputs, "outputs"),
    dependencies: opts.dep,
    dependenciesUrl: opts.indexUrl,
  };
}

export function functionCommand(): Command {
  const cmd = new Command("function").description(
    "Sandbox functions: run Python on the platform without registering anything",
  );

  cmd
    .command("run <file>")
    .description("Run a file (or `-` for stdin) in the sandbox; exits non-zero when the code does")
    .option("--event <json>", "the single argument handler() receives", "{}")
    .option("--timeout <s>", "sandbox timeout in seconds", int)
    .option("--dep <name@version>", "install a package first (repeatable)", collectDep)
    .option("--index-url <url>", "package index to install from (default PyPI)")
    .option(
      "--pass-token",
      "put your credential in the sandbox's BKN_TOKEN so `sandbox_sdk.bkn` calls BKN as you",
    )
    .action(async (file: string, opts, cmd: Command) => {
      const client = clientFrom(cmd);
      const result = await client.functions.run({
        code: readCode(file),
        event: (parseJsonOption(opts.event, "event") ?? {}) as Record<string, unknown>,
        timeout: opts.timeout,
        dependencies: opts.dep,
        dependenciesUrl: opts.indexUrl,
        source: "openbkn_cli",
        // The request headers carry these too, but they stop at the service:
        // the sandbox reads its own environment, which only these fields fill.
        conversationId: client.ctx.trace?.conversationId,
        interactionId: client.ctx.trace?.interactionId,
        ...(opts.passToken ? { bknToken: client.ctx.token } : {}),
      });
      printJson(result, outputOptions(cmd));
      // The service answers 200 for code that raised; `exit_code` is the verdict.
      // A caller in a shell should not have to parse JSON to learn that.
      if (result.exit_code !== undefined && result.exit_code !== 0) process.exitCode = 1;
    });

  cmd
    .command("infer-schema <file>")
    .description(
      "Derive a tool contract from @tool-decorated code; runs it, answers supported:false when it cannot",
    )
    .action(async (file: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).functions.inferSchema(readCode(file)), outputOptions(cmd));
    });

  cmd
    .command("deps")
    .description("Libraries already installed in the sandbox — import these without --dep")
    .action(async (_opts, cmd: Command) => {
      printJson(await clientFrom(cmd).functions.dependencies(), outputOptions(cmd));
    });

  cmd
    .command("versions <package>")
    .description("Versions of one package, asked of the package index live")
    .option("--python <v>", "keep only versions compatible with this Python")
    .option("--index-url <url>", "package index to ask (default PyPI)")
    .action(async (pkg: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).functions.dependencyVersions(pkg, {
          pythonVersion: opts.python,
          pypiRepoUrl: opts.indexUrl,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("template")
    .description("The handler() skeleton to start from")
    .option("--type <t>", "template type (python)", "python")
    .action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).functions.template(opts.type), outputOptions(cmd));
    });

  groupChildren(cmd, {
    READ: ["deps", "versions", "template"],
    RUN: ["run", "infer-schema"],
  });

  guide(
    cmd,
    `THE ONE HARD RULE
  The entry point must be a function named \`handler\`, taking one argument:

      def handler(event: Dict[str, Any]) -> Any:
          return {"sum": event.get("a", 0) + event.get("b", 0)}

  \`--event\` is that argument, the return value comes back as \`result\`, and
  \`print\` output as \`stdout\`. \`function template\` prints the skeleton.

  READING THE ANSWER
  Code that raises still answers HTTP 200 — \`exit_code\` is the verdict and the
  traceback is in \`stderr\`. This command exits non-zero to match, so \`&&\` works.

  CONTEXT INSIDE THE SANDBOX
  --conversation-id / --interaction-id reach the sandbox as BKN_CONVERSATION_ID
  and BKN_INTERACTION_ID, which is how \`sandbox_sdk.bkn\` hangs its own BKN calls
  under your interaction. The credential does not travel unless you say so:
  --pass-token puts it in BKN_TOKEN so that code runs as you.

  ORDER OF WORK
  function deps                      what is already importable
  function run ./add.py --event ...  iterate here; nothing is registered yet
  operator register ./add.py ...     keep it: a named, versioned capability
  operator convert-to-tool <id>      put it in a toolbox for agents to call`,
  );

  return group(cmd, "TOOLS & SKILLS");
}
