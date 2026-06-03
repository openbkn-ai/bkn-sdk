/** `openbkn resource` (alias `res`) — vega-backend resources. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT, DEFAULT_QUERY_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

export function resourceCommand(): Command {
  const cmd = new Command("resource")
    .alias("res")
    .description("Resources — list, find, get, query, delete");

  cmd
    .command("list")
    .description("List resources under a datasource/catalog")
    .option("--datasource-id <id>", "filter by datasource/catalog id")
    .option("--type <category>", "resource category (table | logicview)")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .action(async (opts, cmd: Command) => {
      const data = await clientFrom(cmd).resource.list({
        datasourceId: opts.datasourceId,
        category: opts.type,
        limit: opts.limit,
      });
      printJson(data, outputOptions(cmd));
    });

  cmd
    .command("find")
    .description("Search resources by name (fuzzy; --exact for strict)")
    .requiredOption("--name <name>", "resource name to search")
    .option("--exact", "exact name match")
    .option("--datasource-id <id>", "limit to a datasource/catalog")
    .action(async (opts, cmd: Command) => {
      const data = await clientFrom(cmd).resource.find(opts.name, {
        exact: opts.exact,
        datasourceId: opts.datasourceId,
      });
      printJson(data, outputOptions(cmd));
    });

  cmd
    .command("get <id>")
    .description("Get resource details")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).resource.get(id), outputOptions(cmd));
    });

  cmd
    .command("query <id>")
    .description("Fetch data rows from a resource")
    .option("--limit <n>", "row limit", int, DEFAULT_QUERY_LIMIT)
    .option("--offset <n>", "row offset", int, 0)
    .option("--need-total", "include total count")
    .action(async (id: string, opts, cmd: Command) => {
      const data = await clientFrom(cmd).resource.query(id, {
        limit: opts.limit,
        offset: opts.offset,
        needTotal: opts.needTotal,
      });
      printJson(data, outputOptions(cmd));
    });

  cmd
    .command("delete <id>")
    .description("Delete a resource")
    .option("-y, --yes", "skip confirmation")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).resource.delete(id), outputOptions(cmd));
    });

  return group(cmd, "AI DATA PLATFORM");
}
