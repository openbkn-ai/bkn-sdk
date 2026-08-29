// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn operator …` — registered, versioned capabilities (Studio calls them 函数集). */
import { Command } from "commander";
import type { DependencyInfo } from "../api/functions.js";
import type { OperatorStatus, ParameterDef, RegisterOperatorOptions } from "../api/operators.js";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";
import { collectDep, parseJsonOption, readCode } from "./function.js";

const int = (v: string) => Number.parseInt(v, 10);

const STATUSES: OperatorStatus[] = ["unpublish", "published", "offline", "editing"];

function parameterList(raw: string | undefined, label: string): ParameterDef[] | undefined {
  const parsed = parseJsonOption(raw, label);
  if (parsed === undefined) return undefined;
  if (!Array.isArray(parsed)) throw new InputError(`--${label} must be a JSON array of parameters`);
  return parsed as ParameterDef[];
}

/** The register/update body, built once because both commands take the same flags. */
interface DefinitionOpts {
  name?: string;
  description?: string;
  type?: string;
  inputs?: string;
  outputs?: string;
  category?: string;
  dep?: DependencyInfo[];
  indexUrl?: string;
  timeout?: number;
}

function definitionFrom(file: string, opts: DefinitionOpts): RegisterOperatorOptions {
  const common = {
    description: opts.description,
    category: opts.category,
    ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
  };
  if (opts.type === "openapi") {
    return { ...common, metadataType: "openapi", data: readCode(file) };
  }
  if (opts.type !== "function") throw new InputError("--type must be function or openapi");
  if (!opts.name) throw new InputError("--name is required for a function operator");
  return {
    ...common,
    metadataType: "function",
    function: {
      name: opts.name,
      description: opts.description,
      code: readCode(file),
      inputs: parameterList(opts.inputs, "inputs"),
      outputs: parameterList(opts.outputs, "outputs"),
      dependencies: opts.dep,
      dependenciesUrl: opts.indexUrl,
    },
  };
}

function definitionOptions(c: Command): Command {
  return c
    .option("--name <n>", "operator name; required for a function operator")
    .option("--description <d>", "what it does — the model reads this to decide when to call it")
    .option("--type <t>", "function | openapi", "function")
    .option("--inputs <json>", "input parameters: [{name,type,required,description}]")
    .option("--outputs <json>", "output parameters, same shape as --inputs")
    .option("--category <c>", "category (see `openbkn operator categories`)")
    .option("--dep <name@version>", "package to install before running (repeatable)", collectDep)
    .option("--index-url <url>", "package index to install from")
    .option("--timeout <ms>", "execute-control timeout in milliseconds", int);
}

export function operatorCommand(): Command {
  const cmd = new Command("operator").description(
    "Operators: keep a function as a named, versioned capability and publish it",
  );

  cmd
    .command("list")
    .description("List operators in the workspace, published or not")
    .option("--keyword <s>", "filter by name")
    .option("--status <s>", `filter by status: ${STATUSES.join(" | ")}`)
    .option("--category <c>", "filter by category")
    .option("--type <t>", "basic | composite")
    .option("--create-user <u>", "filter by creator")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--page <n>", "page (1-based)", int)
    .option("--all", "return every operator, ignoring paging")
    .action(async (opts, cmd: Command) => {
      if (opts.status && !STATUSES.includes(opts.status)) {
        throw new InputError(`--status must be one of ${STATUSES.join(", ")}`);
      }
      printJson(
        await clientFrom(cmd).operators.list({
          name: opts.keyword,
          status: opts.status,
          category: opts.category,
          operatorType: opts.type,
          createUser: opts.createUser,
          pageSize: opts.limit,
          page: opts.page,
          all: opts.all,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("get <operator-id>")
    .description("The current version of one operator, with its code and parameters")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).operators.get(id), outputOptions(cmd));
    });

  cmd
    .command("names <operator-ids...>")
    .description("Ids to names; ids that do not exist come back missing, not reported")
    .action(async (ids: string[], _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).operators.names(ids), outputOptions(cmd));
    });

  cmd
    .command("categories")
    .description("Categories --category accepts, machine value plus display name")
    .action(async (_opts, cmd: Command) => {
      printJson(await clientFrom(cmd).operators.categories(), outputOptions(cmd));
    });

  cmd
    .command("history <operator-id> [version]")
    .description("Versions this operator has published; with a version, that version in full")
    .action(async (id: string, version: string | undefined, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).operators.history(id, version), outputOptions(cmd));
    });

  cmd
    .command("market")
    .description("The market view — published and offline operators only")
    .option("--keyword <s>", "filter by name")
    .option("--status <s>", "published | offline (the only two the market has)")
    .option("--category <c>", "filter by category")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--page <n>", "page (1-based)", int)
    .action(async (opts, cmd: Command) => {
      if (opts.status && opts.status !== "published" && opts.status !== "offline") {
        throw new InputError("--status in the market is published or offline");
      }
      printJson(
        await clientFrom(cmd).operators.market({
          name: opts.keyword,
          status: opts.status,
          category: opts.category,
          pageSize: opts.limit,
          page: opts.page,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("market-get <operator-id>")
    .description("One operator as the market shows it")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).operators.marketGet(id), outputOptions(cmd));
    });

  cmd
    // The version is an argument, not a flag: `--version` belongs to the CLI
    // itself and would print the CLI's version instead of reaching this command.
    .command("debug <operator-id> <version>")
    .description("Run one named version and see what it answers")
    .option("--body <json>", "request body — a function operator uses only this")
    .option("--header <json>", "headers map JSON")
    .option("--query <json>", "query params JSON")
    .option("--path <json>", "path params JSON")
    .option("--timeout <s>", "per-call timeout seconds", int)
    .action(async (id: string, version: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).operators.debug(id, {
          version,
          body: parseJsonOption(opts.body, "body"),
          header: parseJsonOption(opts.header, "header") as Record<string, unknown> | undefined,
          query: parseJsonOption(opts.query, "query") as Record<string, unknown> | undefined,
          path: parseJsonOption(opts.path, "path") as Record<string, unknown> | undefined,
          timeout: opts.timeout,
        }),
        outputOptions(cmd),
      );
    });

  definitionOptions(
    cmd
      .command("register <file>")
      .description("Register code (or an OpenAPI spec) as an operator; answers its id and version")
      .option("--publish", "publish it in the same step instead of leaving it unpublished"),
  ).action(async (file: string, opts, cmd: Command) => {
    printJson(
      await clientFrom(cmd).operators.register({
        ...definitionFrom(file, opts),
        directPublish: Boolean(opts.publish),
      }),
      outputOptions(cmd),
    );
  });

  definitionOptions(
    cmd
      .command("update <operator-id> <file>")
      .description("Replace an operator's definition wholesale, producing a new version"),
  ).action(async (id: string, file: string, opts, cmd: Command) => {
    printJson(
      await clientFrom(cmd).operators.update(id, definitionFrom(file, opts)),
      outputOptions(cmd),
    );
  });

  cmd
    .command("publish <operator-ids...>")
    .description("Publish operators — they appear in the market")
    .action(async (ids: string[], _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).operators.publish(ids), outputOptions(cmd));
    });

  cmd
    .command("offline <operator-ids...>")
    .description("Withdraw operators from the market (status=offline)")
    .action(async (ids: string[], _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).operators.offline(ids), outputOptions(cmd));
    });

  cmd
    .command("delete <operator-ids...>")
    .description("Delete operators")
    .option("-y, --yes", "skip confirmation")
    .action(async (ids: string[], _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).operators.delete(ids), outputOptions(cmd));
    });

  cmd
    .command("convert-to-tool <operator-id>")
    .description("Copy an operator into a toolbox as a tool, keeping the lineage")
    .requiredOption("--toolbox <box-id>", "target toolbox id")
    .option("--use-rule <s>", "usage rule carried onto the tool")
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).operators.convertToTool(id, opts.toolbox, { useRule: opts.useRule }),
        outputOptions(cmd),
      );
    });

  groupChildren(cmd, {
    READ: ["list", "get", "names", "categories", "history", "market", "market-get"],
    RUN: ["debug"],
    WRITE: ["register", "update", "publish", "offline", "delete", "convert-to-tool"],
  });

  guide(
    cmd,
    `WHAT AN OPERATOR IS
  A sandbox function that has been kept: named, versioned, and publishable.
  \`openbkn function run\` is the same code with none of that. An agent does not
  call an operator — it calls a tool, which \`convert-to-tool\` makes from one.

  ORDER OF WORK
  function run ./add.py                     get the code right first
  operator register ./add.py --name add \\
      --description "..." --publish         id + version come back
  operator debug <id> <version> \\
      --body '{"a":1,"b":2}'                run that exact version
                                            (version: operator history <id>)
  operator convert-to-tool <id> \\
      --toolbox <box-id>                    now agents can reach it
  operator offline <id>                     take it out of the market again

  \`--inputs\` / \`--outputs\` are how the model learns what to pass. Leaving them
  out registers fine and leaves the operator undescribed.

  STATUS MOVES ONE STEP AT A TIME
  unpublish -> published -> offline, and \`update\` puts a published operator back
  into \`editing\`. There is no editing -> offline: publish the edit first, then
  take it offline. \`list\` shows the status you are actually in.`,
  );

  return group(cmd, "TOOLS & SKILLS");
}
