// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** Sandbox code helpers and `openbkn sandbox …` commands. */
import { readFileSync } from "node:fs";
import { Command } from "commander";
import {
  type DependencyInfo,
  FunctionAiGenerationType as FUNCTION_AI_GENERATION_TYPES,
  type FunctionAiGenerationRequest,
  type FunctionAiGenerationType,
  type FunctionDefinition,
  type ParameterDef,
} from "../api/functions.js";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

/** `--timeout` for calls where a typo must not silently become another limit. */
export function positiveSeconds(flag: string) {
  return (v: string): number => {
    const n = /^\d+$/.test(v) ? Number.parseInt(v, 10) : Number.NaN;
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new InputError(`${flag} must be a positive integer (got '${v}')`);
    }
    return n;
  };
}

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
 * The flags that describe a function, shared with `tool create` so a caller
 * learns them once: `openbkn function` iterates on the code, `tool create`
 * keeps it, both with these names.
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

export function definitionFlags(c: Command, includeType = true): Command {
  const flags = c
    .option("--name <n>", "name; required when the definition is a function")
    .option("--description <d>", "what it does — the model reads this to decide when to call it")
    .option("--inputs <json>", "input parameters: [{name,type,required,description}]")
    .option("--outputs <json>", "output parameters, same shape as --inputs")
    .option("--dep <name@version>", "package to install before running (repeatable)", collectDep)
    .option("--index-url <url>", "package index to install from");
  return includeType ? flags.option("--type <t>", "function | openapi", "function") : flags;
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

/** Validate a Function generation direction before a request is opened. */
export function generationType(value: string): FunctionAiGenerationType {
  if ((FUNCTION_AI_GENERATION_TYPES as readonly string[]).includes(value)) {
    return value as FunctionAiGenerationType;
  }
  throw new InputError(
    `type must be one of: ${FUNCTION_AI_GENERATION_TYPES.join(" | ")} (got '${value}')`,
  );
}

export interface GenerationFlags {
  query?: string;
  code?: string;
  inputs?: string;
  outputs?: string;
}

/** Convert the type-specific CLI flags to the documented JSON request body. */
export function generationRequestFrom(
  type: FunctionAiGenerationType,
  opts: GenerationFlags,
): FunctionAiGenerationRequest {
  const inputs = parameterList(opts.inputs, "inputs");
  const outputs = parameterList(opts.outputs, "outputs");
  if (type === "python_function_generator") {
    if (!opts.query?.trim()) {
      throw new InputError("--query is required for python_function_generator");
    }
    if (opts.code !== undefined) {
      throw new InputError("--code only applies to metadata_param_generator");
    }
    return { query: opts.query, inputs, outputs };
  }
  if (opts.query !== undefined) {
    throw new InputError("--query only applies to python_function_generator");
  }
  if (!opts.code) {
    throw new InputError("--code <file> is required for metadata_param_generator");
  }
  return { code: readCode(opts.code), inputs, outputs };
}

export function sandboxCommand(): Command {
  const cmd = new Command("sandbox").description(
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

  cmd
    .command("generate <type>")
    .description("Generate function code or parameter metadata with the platform's default LLM")
    .option("--query <text>", "natural-language request (python_function_generator)")
    .option("--code <file>", "existing code to analyse (metadata_param_generator; `-` reads stdin)")
    .option("--inputs <json>", "known input parameters to constrain generation")
    .option("--outputs <json>", "known output parameters to constrain generation")
    .option(
      "--timeout <s>",
      "seconds to wait for the model (default 300, the gateway's own limit)",
      positiveSeconds("--timeout"),
    )
    .action(async (type: string, opts: GenerationFlags & { timeout?: number }, cmd: Command) => {
      const direction = generationType(type);
      printJson(
        await clientFrom(cmd).functions.generate(
          direction,
          generationRequestFrom(direction, opts),
          opts.timeout === undefined ? {} : { timeoutMs: opts.timeout * 1000 },
        ),
        outputOptions(cmd),
      );
    });

  cmd
    .command("prompt <type>")
    .description("Read the prompt template used for one Function AI generation direction")
    .action(async (type: string, _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).functions.promptTemplate(generationType(type)),
        outputOptions(cmd),
      );
    });

  groupChildren(cmd, {
    READ: ["deps", "versions", "template", "prompt"],
    RUN: ["run", "infer-schema", "generate"],
  });

  guide(
    cmd,
    `THE ONE HARD RULE
  The entry point must be a function named \`handler\`, taking one argument:

      def handler(event: Dict[str, Any]) -> Any:
          return {"sum": event.get("a", 0) + event.get("b", 0)}

  \`--event\` is that argument, the return value comes back as \`result\`, and
  \`print\` output as \`stdout\`. \`sandbox template\` prints the skeleton.

  READING THE ANSWER
  Code that raises still answers HTTP 200 — \`exit_code\` is the verdict and the
  traceback is in \`stderr\`. This command exits non-zero to match, so \`&&\` works.

  CONTEXT INSIDE THE SANDBOX
  --conversation-id / --interaction-id reach the sandbox as BKN_CONVERSATION_ID
  and BKN_INTERACTION_ID, which is how \`sandbox_sdk.bkn\` hangs its own BKN calls
  under your interaction. The credential does not travel unless you say so:
  --pass-token puts it in BKN_TOKEN so that code runs as you.

  ORDER OF WORK
  sandbox deps                       what is already importable
  sandbox run ./add.py --event ...   iterate here; nothing is kept
  sandbox generate python_function_generator --query "..."
                                     draft a handler with the platform model
  toolbox create --type function     a box to keep it in
  function create ./add.py --toolbox the same code, now a registered Function Tool
  function debug <tool-id> --toolbox try it before enabling or publishing
  function enable <tool-id> --toolbox
                                     a tool is off until enabled
  toolbox publish <box-id>           execute needs a published box
  function execute <tool-id> --toolbox
                                     the call agents make

  LONG JOBS
  A registered function called through the toolbox is cut at about 30s whatever
  its --timeout, and answers 200 with result: null. Keep long work on
  \`sandbox run\`, which waits for the sandbox's own limit (the gateway still
  answers 504 after about 300s).`,
  );

  return group(cmd, "TOOLS & SKILLS");
}
