// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn resource` (alias `res`) — vega-backend resources. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT, DEFAULT_QUERY_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);
const parsePairs = (raw?: string): Array<{ key: string; value: string }> | undefined => {
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((part) => {
      const idx = part.indexOf("=");
      if (idx < 1) throw new Error("--extension must be key=value[,key=value]");
      return { key: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
    })
    .filter((p) => p.key.length > 0);
};

export function resourceCommand(): Command {
  const cmd = new Command("resource")
    .alias("res")
    .description("Resources — list, find, get, query, delete");

  cmd
    .command("list")
    .description("List resources under a catalog")
    .option("--catalog-id <id>", "filter by catalog id")
    .option("--datasource-id <id>", "alias of --catalog-id")
    .option("--category <c>", "resource category (table | logicview | dataset)")
    .option("--type <c>", "alias of --category")
    .option("--status <status>", "filter by status")
    .option("--database <name>", "filter by database")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--include-extensions", "include all extension key/value pairs")
    .option("--include-extension-keys <keys>", "include selected extension keys")
    .option("--extension <k=v,...>", "filter by extension key/value pairs")
    .option("--sort <field>", "sort field: name | create_time | update_time")
    .option("--direction <dir>", "sort direction: asc | desc")
    .action(async (opts, cmd: Command) => {
      const data = await clientFrom(cmd).resource.list({
        datasourceId: opts.catalogId ?? opts.datasourceId,
        category: opts.category ?? opts.type,
        status: opts.status,
        database: opts.database,
        limit: opts.limit,
        offset: opts.offset,
        includeExtensions: opts.includeExtensions,
        includeExtensionKeys: opts.includeExtensionKeys,
        extensionPairs: parsePairs(opts.extension),
        sort: opts.sort,
        direction: opts.direction,
      });
      printJson(data, outputOptions(cmd));
    });

  cmd
    .command("find")
    .description("Search resources by name (fuzzy; --exact for strict)")
    .requiredOption("--name <name>", "resource name to search")
    .option("--exact", "exact name match")
    .option("--catalog-id <id>", "limit to a catalog")
    .option("--datasource-id <id>", "alias of --catalog-id")
    .action(async (opts, cmd: Command) => {
      const data = await clientFrom(cmd).resource.find(opts.name, {
        exact: opts.exact,
        datasourceId: opts.catalogId ?? opts.datasourceId,
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
