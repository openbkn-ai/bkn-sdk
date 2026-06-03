/** `openbkn context …` (alias of legacy context-loader) — MCP retrieval. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

function notImplemented(path: string): () => never {
  return () => {
    throw new Error(`\`openbkn context ${path}\` is not implemented yet.`);
  };
}

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

  // Remaining MCP/query subcommands kept as stubs.
  for (const name of [
    "query-instance-subgraph",
    "get-logic-properties",
    "get-action-info",
    "resources",
    "resource",
    "templates",
    "prompts",
    "prompt",
  ]) {
    cmd
      .command(name)
      .description(`${name} (pending)`)
      .allowUnknownOption()
      .action(notImplemented(name));
  }

  return group(cmd, "AI DATA PLATFORM");
}
