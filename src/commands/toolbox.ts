// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn toolbox …` and `openbkn tool …` — agent toolboxes + tools. */
import { Command } from "commander";
import yaml from "js-yaml";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";
import { type CodeFlags, definitionFlags, functionDefinitionFrom, readCode } from "./function.js";

const int = (v: string) => Number.parseInt(v, 10);

export function toolboxCommand(): Command {
  const cmd = new Command("toolbox").description("Toolboxes: group tools into one publishable box");

  cmd
    .command("list")
    .description("List toolboxes")
    .option("--keyword <s>", "filter by keyword")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.list({
          keyword: opts.keyword,
          limit: opts.limit,
          offset: opts.offset,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("create")
    .description(
      "Create a toolbox — openapi proxies to a service, function holds platform functions",
    )
    .requiredOption("--name <name>", "toolbox name")
    .option("--service-url <url>", "where an openapi box proxies its tools; required for that type")
    .option("--type <t>", "openapi | function", "openapi")
    .option("--description <d>", "description")
    .action(async (opts, cmd: Command) => {
      if (opts.type !== "openapi" && opts.type !== "function") {
        throw new InputError("--type must be openapi or function");
      }
      if (opts.type === "openapi" && !opts.serviceUrl) {
        throw new InputError("--service-url is required for an openapi toolbox");
      }
      printJson(
        await clientFrom(cmd).toolboxes.create({
          name: opts.name,
          serviceUrl: opts.serviceUrl,
          description: opts.description,
          metadataType: opts.type,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("publish <box-id>")
    .description("Publish a toolbox")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).toolboxes.publish(id), outputOptions(cmd));
    });

  cmd
    .command("unpublish <box-id>")
    .description("Unpublish a toolbox (status=draft)")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).toolboxes.unpublish(id), outputOptions(cmd));
    });

  cmd
    .command("delete <box-id>")
    .description("Delete a toolbox")
    .option("-y, --yes", "skip confirmation")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).toolboxes.delete(id), outputOptions(cmd));
    });

  cmd
    .command("export <box-id>")
    .description("Export a toolbox config to a local .adp file")
    .requiredOption("-o, --out <file>", "output .adp path")
    .option("--type <t>", "impex type: toolbox | mcp | operator", "toolbox")
    .action(async (boxId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.export(boxId, opts.out, opts.type),
        outputOptions(cmd),
      );
    });
  cmd
    .command("import <file>")
    .description("Import a toolbox config from a local .adp file")
    .option("--type <t>", "impex type: toolbox | mcp | operator", "toolbox")
    .action(async (file: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).toolboxes.import(file, opts.type), outputOptions(cmd));
    });

  groupChildren(cmd, {
    READ: ["list", "export"],
    WRITE: ["create", "publish", "unpublish", "delete", "import"],
  });

  guide(
    cmd,
    `TWO KINDS OF BOX
  --type openapi   its tools proxy to --service-url; they come from a spec
  --type function  its tools are platform functions, no service URL to give

  ORDER OF WORK
  toolbox create --name "<n>"        an empty box, in draft
  tool create ./add.py --toolbox     a function tool, or --type openapi for a spec
  tool enable <tool-ids...>          a tool is off until enabled
  toolbox publish <box-id>           the box becomes visible in the market
  tool execute <tool-id>             call an enabled tool
  tool debug <tool-id>               call one that is not, while building it

  Publishing the box is about the market, not about calling: an enabled tool in
  an unpublished box executes. \`tool enable\` is the gate.

  export / import move a whole box between deploys as an .adp file.`,
  );

  return group(cmd, "TOOLS & SKILLS");
}

export function toolCommand(): Command {
  const cmd = new Command("tool").description(
    "Tools in a box: add one from code or a spec, enable it, call it",
  );

  cmd
    .command("list")
    .description("List tools in a toolbox")
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .option("--limit <n>", "page size (backend default 10, max 100)", int)
    .option("--page <n>", "page (1-based; backend default 1)", int)
    .option("--all", "return every tool, ignoring page size")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.tools(opts.toolbox, {
          page: opts.page,
          pageSize: opts.limit,
          all: opts.all,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("enable <tool-ids...>")
    .description("Enable one or more tools")
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .action(async (toolIds: string[], opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.setToolStatus(opts.toolbox, toolIds, "enabled"),
        outputOptions(cmd),
      );
    });

  cmd
    .command("disable <tool-ids...>")
    .description("Disable one or more tools")
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .action(async (toolIds: string[], opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.setToolStatus(opts.toolbox, toolIds, "disabled"),
        outputOptions(cmd),
      );
    });

  const invokeOpts = (c: Command) =>
    c
      .requiredOption("--toolbox <box-id>", "toolbox id")
      .option(
        "--body <json>",
        "request body JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (execution-factory)",
      )
      .option("--header <json>", "headers map JSON")
      .option("--query <json>", "query params JSON")
      .option("--path <json>", "path params JSON")
      .option("--timeout <s>", "per-call timeout seconds", int);

  const parseJson = (s: string | undefined, label: string): Record<string, unknown> | undefined => {
    if (!s) return undefined;
    try {
      return parseBigIntJSON(s) as Record<string, unknown>;
    } catch {
      throw new InputError(`--${label} must be valid JSON`);
    }
  };

  const buildEnvelope = (opts: Record<string, string | undefined>) => ({
    body: opts.body ? parseBigIntJSON(opts.body) : undefined,
    header: parseJson(opts.header, "header"),
    query: parseJson(opts.query, "query"),
    path: parseJson(opts.path, "path"),
    timeout: opts.timeout ? Number(opts.timeout) : undefined,
  });

  invokeOpts(cmd.command("execute <tool-id>").description("Invoke an enabled tool")).action(
    async (toolId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.execute(opts.toolbox, toolId, buildEnvelope(opts)),
        outputOptions(cmd),
      );
    },
  );
  invokeOpts(
    cmd.command("debug <tool-id>").description("Invoke a tool that is not enabled yet"),
  ).action(async (toolId: string, opts, cmd: Command) => {
    printJson(
      await clientFrom(cmd).toolboxes.debug(opts.toolbox, toolId, buildEnvelope(opts)),
      outputOptions(cmd),
    );
  });

  interface ToolFlags extends CodeFlags {
    toolbox: string;
    useRule?: string;
  }

  /** What goes into a tool, from a code file or a spec file plus the shared flags. */
  const toolFrom = (file: string, opts: ToolFlags) => {
    if (opts.type === "openapi") {
      // Parsed, not raw: this endpoint wants the document itself. `js-yaml`
      // reads JSON too, so one call covers both spellings of a spec.
      let data: unknown;
      try {
        data = yaml.load(readCode(file));
      } catch (err) {
        throw new InputError(
          `${file} is not valid JSON or YAML: ${err instanceof Error ? err.message : err}`,
        );
      }
      return { metadataType: "openapi" as const, data, useRule: opts.useRule };
    }
    if (opts.type !== "function") throw new InputError("--type must be function or openapi");
    return {
      metadataType: "function" as const,
      function: functionDefinitionFrom(file, opts),
      useRule: opts.useRule,
    };
  };

  definitionFlags(
    cmd
      .command("create <file>")
      .description(
        "Create a tool from code (or a spec) — the only way to add a function tool to a box",
      )
      .requiredOption("--toolbox <box-id>", "target toolbox id")
      .option("--use-rule <s>", "usage rule carried onto the tool"),
  ).action(async (file: string, opts: ToolFlags, cmd: Command) => {
    const result = (await clientFrom(cmd).toolboxes.createTool(
      opts.toolbox,
      toolFrom(file, opts),
    )) as { failure_count?: number };
    printJson(result, outputOptions(cmd));
    // One spec makes one tool per operation, so some can fail while the
    // request succeeds. A caller should not have to read JSON to notice.
    if (result?.failure_count) process.exitCode = 1;
  });

  cmd
    .command("get <tool-id>")
    .description("One tool in full: metadata, parameters, usage rule")
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .action(async (toolId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).toolboxes.getTool(opts.toolbox, toolId), outputOptions(cmd));
    });

  definitionFlags(
    cmd
      .command("update <tool-id> <file>")
      .description("Replace a tool's definition; the id survives and an enabled tool stays enabled")
      .requiredOption("--toolbox <box-id>", "toolbox id")
      .option("--use-rule <s>", "usage rule carried onto the tool"),
  ).action(async (toolId: string, file: string, opts: ToolFlags, cmd: Command) => {
    if (!opts.name || !opts.description) {
      throw new InputError(
        "--name and --description are required: update replaces the tool, it does not patch it",
      );
    }
    printJson(
      await clientFrom(cmd).toolboxes.updateTool(opts.toolbox, toolId, {
        ...toolFrom(file, opts),
        name: opts.name,
        description: opts.description,
      }),
      outputOptions(cmd),
    );
  });

  cmd
    .command("delete <tool-ids...>")
    .description("Delete tools from a toolbox")
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .option("-y, --yes", "skip confirmation")
    .action(async (toolIds: string[], opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.deleteTools(opts.toolbox, toolIds),
        outputOptions(cmd),
      );
    });

  cmd
    .command("upload <file>")
    .description("Add tools from an OpenAPI file — `tool create` is the same endpoint, as JSON")
    .requiredOption("--toolbox <id>", "target toolbox id")
    .option("--metadata-type <t>", "metadata type", "openapi")
    .action(async (file: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.upload(opts.toolbox, file, opts.metadataType),
        outputOptions(cmd),
      );
    });

  groupChildren(cmd, {
    READ: ["list", "get"],
    RUN: ["execute", "debug"],
    WRITE: ["create", "update", "delete", "enable", "disable", "upload"],
  });

  return group(cmd, "TOOLS & SKILLS");
}
