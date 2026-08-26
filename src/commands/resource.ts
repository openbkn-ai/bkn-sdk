// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

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
    .description("List resources under a catalog")
    .option("--catalog-id <id>", "filter by catalog id")
    .option("--category <c>", "resource category (table | logicview | dataset)")
    .option("--type <c>", "alias of --category")
    .option("--status <status>", "filter by status")
    .option("--schema <name>", "filter by source schema")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--sort <field>", "sort field: name | create_time | update_time")
    .option("--direction <dir>", "sort direction: asc | desc")
    .action(async (opts, cmd: Command) => {
      const data = await clientFrom(cmd).resource.list({
        catalogId: opts.catalogId,
        category: opts.category ?? opts.type,
        status: opts.status,
        schema: opts.schema,
        limit: opts.limit,
        offset: opts.offset,
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
    .option("--limit <n>", "rows to scan before filtering", int, DEFAULT_LIST_LIMIT)
    .action(async (opts, cmd: Command) => {
      const data = await clientFrom(cmd).resource.find(opts.name, {
        exact: opts.exact,
        catalogId: opts.catalogId,
        limit: opts.limit,
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
    .option("--paging-mode <mode>", "paging mode: single | cursor")
    .option("--keep-alive-sec <s>", "cursor keep-alive in seconds (60–3600)", int)
    .option("--cursor <cursor>", "opaque cursor returned by the previous page")
    .option("--need-total", "include total count")
    .action(async (id: string, opts, cmd: Command) => {
      const data = await clientFrom(cmd).resource.query(id, {
        limit: opts.limit,
        offset: opts.offset,
        pagingMode: opts.pagingMode,
        keepAliveSec: opts.keepAliveSec,
        cursor: opts.cursor,
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
