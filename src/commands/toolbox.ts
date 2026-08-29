// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn toolbox …` and `openbkn tool …` — agent toolboxes + tools. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

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
    .description("Create a toolbox")
    .requiredOption("--name <name>", "toolbox name")
    .requiredOption("--service-url <url>", "tool service URL")
    .option("--description <d>", "description")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.create({
          name: opts.name,
          serviceUrl: opts.serviceUrl,
          description: opts.description,
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

  return group(cmd, "TOOLS & SKILLS");
}

export function toolCommand(): Command {
  const cmd = new Command("tool").description(
    "Tools in a box: upload an OpenAPI spec, enable, call",
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

  invokeOpts(
    cmd.command("execute <tool-id>").description("Invoke a published+enabled tool"),
  ).action(async (toolId: string, opts, cmd: Command) => {
    printJson(
      await clientFrom(cmd).toolboxes.execute(opts.toolbox, toolId, buildEnvelope(opts)),
      outputOptions(cmd),
    );
  });
  invokeOpts(
    cmd.command("debug <tool-id>").description("Invoke a tool (draft/disabled too)"),
  ).action(async (toolId: string, opts, cmd: Command) => {
    printJson(
      await clientFrom(cmd).toolboxes.debug(opts.toolbox, toolId, buildEnvelope(opts)),
      outputOptions(cmd),
    );
  });

  cmd
    .command("upload <file>")
    .description("Upload a tool definition file (OpenAPI spec) into a toolbox")
    .requiredOption("--toolbox <id>", "target toolbox id")
    .option("--metadata-type <t>", "metadata type", "openapi")
    .action(async (file: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.upload(opts.toolbox, file, opts.metadataType),
        outputOptions(cmd),
      );
    });

  return group(cmd, "TOOLS & SKILLS");
}
