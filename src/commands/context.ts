/** `openbkn context …` (alias of legacy context-loader) — MCP retrieval. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

export function contextCommand(): Command {
  const cmd = new Command("context").description(
    "Context loader (MCP) — schema discovery, instance query, skill recall",
  );

  cmd
    .command("search-schema <kn-id> <query>")
    .description("Search object/relation/action/metric schemas")
    .option("--scope <list>", "comma-separated scopes (object,relation,action,metric)")
    .option("--max <n>", "max concepts", int)
    .action(async (knId: string, query: string, opts, cmd: Command) => {
      const data = await clientFrom(cmd).context.searchSchema(knId, query, {
        searchScope: opts.scope ? String(opts.scope).split(",") : undefined,
        maxConcepts: opts.max,
      });
      printJson(data, outputOptions(cmd));
    });

  cmd
    .command("query-object-instance <kn-id>")
    .description("Query object instances (provide --args as JSON)")
    .requiredOption("--args <json>", "tool arguments as JSON")
    .action(async (knId: string, opts, cmd: Command) => {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(opts.args);
      } catch {
        throw new InputError("--args must be valid JSON");
      }
      printJson(await clientFrom(cmd).context.queryObjectInstance(knId, args), outputOptions(cmd));
    });

  cmd
    .command("find-skills <kn-id> <object-type-id>")
    .description("Recall skills for an object type")
    .option("--top-k <n>", "max skills (1-20)", int)
    .action(async (knId: string, otId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).context.findSkills(knId, otId, opts.topK),
        outputOptions(cmd),
      );
    });

  cmd
    .command("tools <kn-id>")
    .description("List MCP tools")
    .action(async (knId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).context.tools(knId), outputOptions(cmd));
    });

  cmd
    .command("tool-call <kn-id> <name>")
    .description("Call any MCP tool directly (--args JSON)")
    .requiredOption("--args <json>", "tool arguments as JSON")
    .action(async (knId: string, name: string, opts, cmd: Command) => {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(opts.args);
      } catch {
        throw new InputError("--args must be valid JSON");
      }
      printJson(await clientFrom(cmd).context.toolCall(knId, name, args), outputOptions(cmd));
    });

  cmd
    .command("resources <kn-id>")
    .description("List MCP resources")
    .action(async (knId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).context.resources(knId), outputOptions(cmd));
    });
  cmd
    .command("resource <kn-id> <uri>")
    .description("Read one MCP resource by uri")
    .action(async (knId: string, uri: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).context.resource(knId, uri), outputOptions(cmd));
    });
  cmd
    .command("templates <kn-id>")
    .description("List MCP resource templates")
    .action(async (knId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).context.templates(knId), outputOptions(cmd));
    });
  cmd
    .command("prompts <kn-id>")
    .description("List MCP prompts")
    .action(async (knId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).context.prompts(knId), outputOptions(cmd));
    });
  cmd
    .command("prompt <kn-id> <name>")
    .description("Get one MCP prompt (--args JSON for prompt arguments)")
    .option("--args <json>", "prompt arguments as JSON")
    .action(async (knId: string, name: string, opts, cmd: Command) => {
      let args: Record<string, unknown> | undefined;
      if (opts.args) {
        try {
          args = JSON.parse(opts.args);
        } catch {
          throw new InputError("--args must be valid JSON");
        }
      }
      printJson(await clientFrom(cmd).context.prompt(knId, name, args), outputOptions(cmd));
    });

  const jsonArgs = (raw: string): Record<string, unknown> => {
    try {
      return JSON.parse(raw);
    } catch {
      throw new InputError("--args must be valid JSON");
    }
  };
  cmd
    .command("query-instance-subgraph <kn-id>")
    .description("Layer-2: query an instance subgraph across relation-type paths")
    .requiredOption("--args <json>", "tool arguments as JSON")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).context.queryInstanceSubgraph(knId, jsonArgs(opts.args)),
        outputOptions(cmd),
      );
    });
  cmd
    .command("get-logic-properties <kn-id>")
    .description("Layer-3: compute logic-property values for instances")
    .requiredOption("--args <json>", "tool arguments as JSON")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).context.logicProperties(knId, jsonArgs(opts.args)),
        outputOptions(cmd),
      );
    });
  cmd
    .command("get-action-info <kn-id>")
    .description("Layer-3: fetch action info / dynamic tools for an instance")
    .requiredOption("--args <json>", "tool arguments as JSON")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).context.actionInfo(knId, jsonArgs(opts.args)),
        outputOptions(cmd),
      );
    });

  return group(cmd, "AI DATA PLATFORM");
}
