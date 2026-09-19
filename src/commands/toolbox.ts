// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn toolbox …` and `openbkn tool …` — agent toolboxes + tools. */
import { Command, Option } from "commander";
import yaml from "js-yaml";
import {
  type GlobalParameter,
  IMPEX_TYPES,
  TOOL_METADATA_TYPES,
  type ToolMetadataType,
} from "../api/toolboxes.js";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { printJson } from "../utils/output.js";
import { MAX_PAGE_SIZE, clientFrom, oneOf, outputOptions, positiveInt } from "./_shared.js";
import {
  type CodeFlags,
  definitionFlags,
  functionDefinitionFrom,
  parseJsonObjectOption,
  readCode,
} from "./function.js";

const SORT_ORDERS = ["asc", "desc"] as const;
/** A toolbox's lifecycle, per the service. There is no `draft`. */
const TOOLBOX_STATUSES = ["unpublish", "published", "offline"] as const;

/**
 * The proxy answers HTTP 200 and reports the upstream failure in the envelope —
 * `status_code` 500 with an `error` string when the function exec call timed
 * out, for instance. Printing that and exiting 0 reads as success to a script.
 */
export function toolCallFailed(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const { status_code: status, error } = result as { status_code?: unknown; error?: unknown };
  if (typeof status === "number" && status >= 400) return true;
  return typeof error === "string" ? error.length > 0 : error !== undefined && error !== null;
}

/**
 * `--path` values fill URL path segments, and the contract types each one as a
 * string. A number or object would reach the wire as something the service
 * does not accept, so refuse it rather than stringify on the caller's behalf.
 */
export function pathParams(
  parsed: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (parsed === undefined) return undefined;
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") {
      throw new InputError(
        `--path values must be strings (path parameter '${k}' is ${v === null ? "null" : Array.isArray(v) ? "an array" : typeof v})`,
      );
    }
  }
  return parsed as Record<string, string>;
}

/** `--global-parameter`: one object, as the contract requires — not an array. */
export function globalParameterOption(raw: string | undefined): GlobalParameter | undefined {
  const parsed = parseJsonObjectOption(raw, "global-parameter");
  if (parsed === undefined) return undefined;
  for (const k of ["name", "description", "in", "type"]) {
    if (typeof parsed[k] !== "string" || !parsed[k]) {
      throw new InputError(`--global-parameter needs a non-empty string '${k}'`);
    }
  }
  return parsed as unknown as GlobalParameter;
}

export function toolboxCommand(): Command {
  const cmd = new Command("toolbox").description("Toolboxes: group tools into one publishable box");

  cmd
    .command("list")
    .description("List toolboxes → {data, total, page, page_size, has_next}; the id is `box_id`")
    .option("--name <s>", "filter by toolbox name")
    // The service never read `keyword`; kept as a hidden alias so old scripts filter.
    .addOption(new Option("--keyword <s>", "deprecated: use --name").hideHelp())
    .option("--status <s>", "unpublish | published | offline", oneOf("--status", TOOLBOX_STATUSES))
    .option("--category <s>", "filter by category")
    .option(
      "--metadata-type <t>",
      "openapi | function",
      oneOf("--metadata-type", ["openapi", "function"] as const),
    )
    .option("--create-user <s>", "filter by creator")
    .option("--release-user <s>", "filter by publisher")
    .option(
      "--sort-by <f>",
      "create_time | update_time | name (service default update_time)",
      oneOf("--sort-by", ["create_time", "update_time", "name"] as const),
    )
    .option("--sort-order <o>", "asc | desc", oneOf("--sort-order", SORT_ORDERS))
    .option(
      "--limit <n>",
      `page size, 1-${MAX_PAGE_SIZE}`,
      positiveInt("--limit", MAX_PAGE_SIZE),
      DEFAULT_LIST_LIMIT,
    )
    .option("--page <n>", "page (1-based)", positiveInt("--page"), 1)
    .option("--all", "return every toolbox, ignoring page size")
    // The service has no offset; refuse it rather than silently return page 1.
    .addOption(new Option("--offset <n>", "removed: use --page").hideHelp())
    .action(async (opts, cmd: Command) => {
      if (opts.offset !== undefined) {
        throw new InputError("--offset is not supported: the service pages by --page (1-based)");
      }
      if (opts.keyword !== undefined && opts.name !== undefined) {
        throw new InputError("--keyword is a deprecated alias of --name; pass only --name");
      }
      printJson(
        await clientFrom(cmd).toolboxes.list({
          name: opts.name ?? opts.keyword,
          status: opts.status,
          category: opts.category,
          metadataType: opts.metadataType,
          createUser: opts.createUser,
          releaseUser: opts.releaseUser,
          sortBy: opts.sortBy,
          sortOrder: opts.sortOrder,
          pageSize: opts.limit,
          page: opts.page,
          all: opts.all,
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
    .option("--category <c>", "box category (service default other_category)")
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
          category: opts.category,
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
    .description("Take a published toolbox down (status=offline)")
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
    .option(
      "--type <t>",
      "impex type: toolbox | mcp | operator",
      oneOf("--type", IMPEX_TYPES),
      "toolbox",
    )
    .action(async (boxId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.export(boxId, opts.out, opts.type),
        outputOptions(cmd),
      );
    });
  cmd
    .command("import <file>")
    .description("Import a toolbox config from a local .adp file")
    .option(
      "--type <t>",
      "impex type: toolbox | mcp | operator",
      oneOf("--type", IMPEX_TYPES),
      "toolbox",
    )
    .option(
      "--mode <m>",
      "create (fail if it exists; service default) | upsert (update if it exists)",
      oneOf("--mode", ["create", "upsert"] as const),
    )
    .action(async (file: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.import(file, opts.type, opts.mode),
        outputOptions(cmd),
      );
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
  toolbox create --name "<n>"        an empty box, not yet published
  tool create ./add.py --toolbox     a function tool, or --type openapi for a spec
  tool debug <tool-id>               call it while building, before enable/publish
  tool enable <tool-ids...>          a tool is off until enabled
  toolbox publish <box-id>           execute needs a published box
  tool execute <tool-id>             call an enabled tool in a published box

  Both gates apply to \`execute\`: the tool must be enabled and the box published —
  an unpublished or offline box answers 400 ToolNotAvailable. \`debug\` skips both.

  export / import move a whole box between deploys as an .adp file.`,
  );

  return group(cmd, "TOOLS & SKILLS");
}

interface ToolCommandOptions {
  name: string;
  metadataType?: ToolMetadataType;
  createCommand: "create" | "import";
  includeUpload: boolean;
}

export function toolCommand(): Command {
  return buildToolCommand({ name: "tool", createCommand: "create", includeUpload: true });
}

/** Persistent Function Tools, presented without the generic backend noun. */
export function functionToolCommand(): Command {
  return buildToolCommand({
    name: "function",
    metadataType: "function",
    createCommand: "create",
    includeUpload: false,
  });
}

/** Persistent OpenAPI Tools, presented as APIs an operator can import and run. */
export function apiToolCommand(): Command {
  return buildToolCommand({
    name: "api",
    metadataType: "openapi",
    createCommand: "import",
    includeUpload: false,
  });
}

function buildToolCommand(config: ToolCommandOptions): Command {
  const kind = config.metadataType;
  const kindName =
    kind === "function" ? "Function Tools" : kind === "openapi" ? "OpenAPI Tools" : "Tools";
  const cmd = new Command(config.name).description(
    kind
      ? `${kindName} in a toolbox: add one, enable it, and call it`
      : "Advanced tools in a box: add one from code or a spec, enable it, call it",
  );

  cmd
    .command("list")
    .description(kind ? `List ${kindName.toLowerCase()} in a toolbox` : "List tools in a toolbox")
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .option(
      "--limit <n>",
      `page size, 1-${MAX_PAGE_SIZE} (backend default 10)`,
      positiveInt("--limit", MAX_PAGE_SIZE),
    )
    .option("--page <n>", "page (1-based; backend default 1)", positiveInt("--page"))
    .option("--all", "return every tool, ignoring page size")
    .option("--name <s>", "filter by tool name")
    .option(
      "--status <s>",
      "enabled | disabled",
      oneOf("--status", ["enabled", "disabled"] as const),
    )
    .option(
      "--sort-by <f>",
      "create_time | update_time | tool_name (service default create_time)",
      oneOf("--sort-by", ["create_time", "update_time", "tool_name"] as const),
    )
    .option("--sort-order <o>", "asc | desc", oneOf("--sort-order", SORT_ORDERS))
    .option("--user-id <id>", "filter by creator")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.tools(opts.toolbox, {
          page: opts.page,
          pageSize: opts.limit,
          all: opts.all,
          name: opts.name,
          status: opts.status,
          sortBy: opts.sortBy,
          sortOrder: opts.sortOrder,
          userId: opts.userId,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("enable <tool-ids...>")
    .description(kind ? `Enable one or more ${kindName.toLowerCase()}` : "Enable one or more tools")
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .action(async (toolIds: string[], opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.setToolStatus(opts.toolbox, toolIds, "enabled"),
        outputOptions(cmd),
      );
    });

  cmd
    .command("disable <tool-ids...>")
    .description(
      kind ? `Disable one or more ${kindName.toLowerCase()}` : "Disable one or more tools",
    )
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
      .option(
        "--timeout <s>",
        "per-call timeout seconds; the client waits this long plus a margin (sandbox max when omitted)",
        positiveInt("--timeout"),
      );

  const parseJson = (s: string | undefined, label: string): Record<string, unknown> | undefined => {
    if (s === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = parseBigIntJSON(s);
    } catch {
      throw new InputError(`--${label} must be valid JSON`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new InputError(`--${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  };

  const buildEnvelope = (opts: Record<string, string | undefined>) => ({
    body: opts.body ? parseBigIntJSON(opts.body) : undefined,
    header: parseJson(opts.header, "header"),
    query: parseJson(opts.query, "query"),
    path: pathParams(parseJson(opts.path, "path")),
    timeout: opts.timeout ? Number(opts.timeout) : undefined,
  });

  invokeOpts(
    cmd
      .command("execute <tool-id>")
      .description(
        kind
          ? `Invoke an enabled ${kindName.slice(0, -1)} in a published toolbox`
          : "Invoke an enabled tool in a published toolbox",
      ),
  ).action(async (toolId: string, opts, cmd: Command) => {
    const result = await clientFrom(cmd).toolboxes.execute(
      opts.toolbox,
      toolId,
      buildEnvelope(opts),
    );
    printJson(result, outputOptions(cmd));
    if (toolCallFailed(result)) process.exitCode = 1;
  });
  invokeOpts(
    cmd
      .command("debug <tool-id>")
      .description(
        kind
          ? `Invoke a ${kindName.slice(0, -1)} before it is enabled or its toolbox published`
          : "Invoke a tool before it is enabled or its toolbox published",
      ),
  ).action(async (toolId: string, opts, cmd: Command) => {
    const result = await clientFrom(cmd).toolboxes.debug(opts.toolbox, toolId, buildEnvelope(opts));
    printJson(result, outputOptions(cmd));
    if (toolCallFailed(result)) process.exitCode = 1;
  });

  interface ToolFlags extends CodeFlags {
    toolbox: string;
    useRule?: string;
    globalParameter?: string;
    extendInfo?: string;
  }

  const commonToolFields = (opts: ToolFlags) => ({
    useRule: opts.useRule,
    globalParameters: globalParameterOption(opts.globalParameter),
    extendInfo: parseJsonObjectOption(opts.extendInfo, "extend-info"),
  });

  /** Flags every create / update carries, whatever the tool is described by. */
  const toolExtraFlags = (c: Command) =>
    c
      .option("--use-rule <s>", "usage rule carried onto the tool")
      .option(
        "--global-parameter <json>",
        "one parameter fixed onto every call: {name,description,in,type,required?,value?}",
      )
      .option("--extend-info <json>", "extra metadata as a JSON object");

  /** What goes into a tool, from a code file or a spec file plus the shared flags. */
  const toolFrom = (file: string, opts: ToolFlags) => {
    const metadataType = kind ?? opts.type;
    if (metadataType === "openapi") {
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
      return { metadataType: "openapi" as const, data, ...commonToolFields(opts) };
    }
    if (metadataType !== "function") throw new InputError("--type must be function or openapi");
    return {
      metadataType: "function" as const,
      function: functionDefinitionFrom(file, opts),
      ...commonToolFields(opts),
    };
  };

  definitionFlags(
    toolExtraFlags(
      cmd
        .command(`${config.createCommand} <file>`)
        .description(
          kind === "function"
            ? "Register a Function Tool from code"
            : kind === "openapi"
              ? "Import OpenAPI Tools from a JSON or YAML specification"
              : "Create a tool from code (or a spec)",
        )
        .requiredOption("--toolbox <box-id>", "target toolbox id"),
    ),
    !kind,
    kind === "openapi" ? "openapi-import" : "all",
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
    .description(
      kind
        ? `One ${kindName.slice(0, -1)} in full: metadata, parameters, usage rule`
        : "One tool in full: metadata, parameters, usage rule",
    )
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .action(async (toolId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).toolboxes.getTool(opts.toolbox, toolId), outputOptions(cmd));
    });

  definitionFlags(
    toolExtraFlags(
      cmd
        .command("update <tool-id> <file>")
        .description(
          kind
            ? `Replace a ${kindName.slice(0, -1)} definition; the id survives and an enabled tool stays enabled`
            : "Replace a tool's definition; the id survives and an enabled tool stays enabled",
        )
        .requiredOption("--toolbox <box-id>", "toolbox id"),
    ),
    !kind,
    kind === "openapi" ? "openapi-update" : "all",
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
    .description(
      kind ? `Delete ${kindName.toLowerCase()} from a toolbox` : "Delete tools from a toolbox",
    )
    .requiredOption("--toolbox <box-id>", "toolbox id")
    .option("-y, --yes", "skip confirmation")
    .action(async (toolIds: string[], opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).toolboxes.deleteTools(opts.toolbox, toolIds),
        outputOptions(cmd),
      );
    });

  if (config.includeUpload) {
    cmd
      .command("upload <file>")
      .description("Add tools from an OpenAPI file — `tool create` is the same endpoint, as JSON")
      .requiredOption("--toolbox <id>", "target toolbox id")
      .option(
        "--metadata-type <t>",
        "openapi | function",
        oneOf("--metadata-type", TOOL_METADATA_TYPES),
        "openapi",
      )
      .action(async (file: string, opts, cmd: Command) => {
        printJson(
          await clientFrom(cmd).toolboxes.upload(opts.toolbox, file, opts.metadataType),
          outputOptions(cmd),
        );
      });
  }

  groupChildren(cmd, {
    READ: ["list", "get"],
    RUN: ["execute", "debug"],
    WRITE: [
      config.createCommand,
      "update",
      "delete",
      "enable",
      "disable",
      ...(config.includeUpload ? ["upload"] : []),
    ],
  });

  if (kind) {
    guide(
      cmd,
      `WHAT THIS GROUP MANAGES
  ${kind === "function" ? "Function Tools keep Python handler code in a Toolbox." : "OpenAPI Tools keep operations imported from a JSON or YAML specification."}
  \`--toolbox\` is always the container id; create it with \`toolbox create\`.

  ORDER OF WORK
  toolbox create --name "<n>"${kind === "openapi" ? " --service-url <url>" : " --type function"}
  ${config.name} ${config.createCommand} <file> --toolbox <box-id>
  ${config.name} debug <tool-id> --toolbox <box-id>     try it before enable/publish
  ${config.name} enable <tool-id> --toolbox <box-id>
  toolbox publish <box-id>
  ${config.name} execute <tool-id> --toolbox <box-id>

  \`execute\` needs the tool enabled and the box published; an unpublished or offline
  box answers 400 ToolNotAvailable. \`debug\` works before either.
  \`${config.name} list\` does not check the box: --toolbox must name a box whose
  metadata type is ${kind}.${
    kind === "function"
      ? `
  execute and debug go through the toolbox proxy, which cuts a function at about
  30s whatever --timeout says, answering 200 with result: null. Run long jobs
  with \`sandbox run\`.`
      : ""
  }`,
    );
  }

  return group(cmd, "TOOLS & SKILLS");
}
