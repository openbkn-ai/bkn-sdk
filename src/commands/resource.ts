// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn resource` (alias `res`) — vega-backend resources. */
import { Command } from "commander";
import {
  type ListResourcesOptions,
  type QueryResourceOptions,
  ResourceCategory,
  ResourceStatus,
} from "../api/resources.js";
import { group, groupChildren } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT, DEFAULT_QUERY_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { printJson } from "../utils/output.js";
import { clientFrom, csv, oneOf, outputOptions } from "./_shared.js";

const int = (flag: string) => (v: string) => {
  if (!/^-?\d+$/.test(v)) throw new InputError(`${flag} must be an integer (got '${v}')`);
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new InputError(`${flag} must be an integer (got '${v}')`);
  return n;
};

const nonNegativeInt = (flag: string) => (v: string) => {
  const n = int(flag)(v);
  if (n < 0) throw new InputError(`${flag} must be 0 or greater (got '${v}')`);
  return n;
};

/** `keep_alive_sec`: the contract accepts 60–3600 seconds on a first cursor page. */
export const keepAliveSec = (v: string): number => {
  const n = int("--keep-alive-sec")(v);
  if (n < 60 || n > 3600) {
    throw new InputError(`--keep-alive-sec must be an integer from 60 to 3600 (got '${v}')`);
  }
  return n;
};

const SORT_FIELDS = ["name", "create_time", "update_time"] as const;
const DIRECTIONS = ["asc", "desc"] as const;

/** Add the documented `/resources` list filters, each validated against its enum. */
export function addResourceListOptions(cmd: Command, categoryFlag: "--category" | "--type") {
  const alias = categoryFlag === "--category" ? "--type" : "--category";
  return cmd
    .option("--catalog-id <id>", "filter by catalog id")
    .option("--name <name>", "filter by name")
    .option(
      `${categoryFlag} <category>`,
      `resource category: ${ResourceCategory.options.join(" | ")}`,
      oneOf(categoryFlag, ResourceCategory.options),
    )
    .option(
      `${alias} <category>`,
      `alias of ${categoryFlag}`,
      oneOf(alias, ResourceCategory.options),
    )
    .option(
      "--status <status>",
      `filter by status: ${ResourceStatus.options.join(" | ")}`,
      oneOf("--status", ResourceStatus.options),
    )
    .option(
      "--enabled <bool>",
      "filter by enabled state: true | false",
      oneOf("--enabled", ["true", "false"] as const),
    )
    .option("--last-discover-status <status>", "filter by latest discovery status")
    .option("--schema <name>", "filter by source schema")
    .option("--limit <n>", "page size", int("--limit"), DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", nonNegativeInt("--offset"), 0)
    .option(
      "--sort <field>",
      `sort field: ${SORT_FIELDS.join(" | ")}`,
      oneOf("--sort", SORT_FIELDS),
    )
    .option(
      "--direction <dir>",
      `sort direction: ${DIRECTIONS.join(" | ")}`,
      oneOf("--direction", DIRECTIONS),
    );
}

export function resourceListOptionsFrom(opts: Record<string, unknown>): ListResourcesOptions {
  return {
    catalogId: opts.catalogId as string | undefined,
    name: opts.name as string | undefined,
    category: (opts.category ?? opts.type) as ListResourcesOptions["category"],
    status: opts.status as ListResourcesOptions["status"],
    enabled: opts.enabled === undefined ? undefined : opts.enabled === "true",
    lastDiscoverStatus: opts.lastDiscoverStatus as string | undefined,
    schema: opts.schema as string | undefined,
    limit: opts.limit as number,
    offset: opts.offset as number,
    sort: opts.sort as ListResourcesOptions["sort"],
    direction: opts.direction as ListResourcesOptions["direction"],
  };
}

/** Add the ResourceData query flags shared by `resource query` and `vega resource query`. */
export function addResourceQueryOptions(cmd: Command) {
  return cmd
    .option("--limit <n>", "row limit", int("--limit"))
    .option("--offset <n>", "row offset", nonNegativeInt("--offset"))
    .option(
      "--paging-mode <mode>",
      "paging mode: single | cursor",
      oneOf("--paging-mode", ["single", "cursor"] as const),
    )
    .option("--keep-alive-sec <s>", "cursor keep-alive in seconds (60–3600)", keepAliveSec)
    .option("--cursor <cursor>", "opaque cursor returned by the previous page")
    .option("--need-total", "include total count")
    .option("--filter <json>", "Vega filter_condition JSON object")
    .option("--sort <field:dir,...>", "sort fields, e.g. create_time:desc,id:asc")
    .option("--output-fields <f1,f2>", "comma-separated fields to return")
    .option(
      "--binary-mode <mode>",
      "Binary fields as metadata (byte length, default) | content (Base64)",
      oneOf("--binary-mode", ["metadata", "content"] as const),
    )
    .option("--ignore-local-index", "read a table's source even when a local index is available");
}

function parseFilter(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseBigIntJSON(raw);
  } catch {
    throw new InputError("--filter must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InputError("--filter must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function parseSort(raw: string): NonNullable<QueryResourceOptions["sort"]> {
  const items = csv(raw) ?? [];
  if (items.length === 0) throw new InputError("--sort must name at least one field");
  return items.map((item) => {
    const at = item.lastIndexOf(":");
    const field = at === -1 ? item : item.slice(0, at);
    const direction = at === -1 ? "asc" : item.slice(at + 1);
    if (!field || (direction !== "asc" && direction !== "desc")) {
      throw new InputError(`--sort entries must be field[:asc|desc] (got '${item}')`);
    }
    return { field, direction };
  });
}

export function resourceQueryOptionsFrom(
  opts: Record<string, unknown>,
  defaultLimit: number,
): QueryResourceOptions {
  if (opts.cursor) {
    // A continuation carries only the cursor; anything else would be dropped.
    const initialOnly = [
      ["--limit", opts.limit],
      ["--offset", opts.offset],
      ["--paging-mode", opts.pagingMode],
      ["--keep-alive-sec", opts.keepAliveSec],
      ["--filter", opts.filter],
      ["--sort", opts.sort],
      ["--output-fields", opts.outputFields],
      ["--binary-mode", opts.binaryMode],
      ["--ignore-local-index", opts.ignoreLocalIndex],
    ].filter(([, value]) => value !== undefined);
    if (initialOnly.length > 0) {
      throw new InputError(
        `--cursor cannot be combined with initial-query options (${initialOnly.map(([flag]) => flag).join(", ")})`,
      );
    }
    return {
      cursor: opts.cursor as string,
      ...(opts.needTotal ? { needTotal: true } : {}),
    };
  }
  return {
    limit: (opts.limit as number | undefined) ?? defaultLimit,
    offset: (opts.offset as number | undefined) ?? 0,
    pagingMode: opts.pagingMode as QueryResourceOptions["pagingMode"],
    keepAliveSec: opts.keepAliveSec as number | undefined,
    needTotal: opts.needTotal ? true : undefined,
    ...(opts.filter !== undefined ? { filterCondition: parseFilter(opts.filter as string) } : {}),
    ...(opts.sort !== undefined ? { sort: parseSort(opts.sort as string) } : {}),
    ...(opts.outputFields !== undefined
      ? { outputFields: csv(opts.outputFields as string) ?? [] }
      : {}),
    ...(opts.binaryMode !== undefined
      ? { binaryMode: opts.binaryMode as QueryResourceOptions["binaryMode"] }
      : {}),
    ...(opts.ignoreLocalIndex ? { ignoreLocalIndex: true } : {}),
  };
}

export function resourceCommand(): Command {
  const cmd = new Command("resource")
    .alias("res")
    .description("Tables and views behind a network: find, inspect, sample, enable, disable");

  addResourceListOptions(
    cmd.command("list").description("List resources under a catalog"),
    "--category",
  ).action(async (opts, cmd: Command) => {
    const data = await clientFrom(cmd).resource.list(resourceListOptionsFrom(opts));
    printJson(data, outputOptions(cmd));
  });

  cmd
    .command("find")
    .description("Search resources by name, fuzzy unless --exact → a bare array, not an envelope")
    .requiredOption("--name <name>", "resource name to search")
    .option("--exact", "exact name match")
    .option("--catalog-id <id>", "limit to a catalog")
    .option("--limit <n>", "rows to scan before filtering", int("--limit"), DEFAULT_LIST_LIMIT)
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

  for (const action of ["enable", "disable"] as const) {
    cmd
      .command(`${action} <id>`)
      .description(`${action[0]?.toUpperCase()}${action.slice(1)} a resource`)
      .action(async (id: string, _opts, cmd: Command) => {
        const api = clientFrom(cmd).resource;
        const result = action === "enable" ? await api.enable(id) : await api.disable(id);
        printJson(result, outputOptions(cmd));
      });
  }

  addResourceQueryOptions(
    cmd
      .command("query <id>")
      .description(`Fetch data rows from a resource (default limit ${DEFAULT_QUERY_LIMIT})`),
  ).action(async (id: string, opts, cmd: Command) => {
    const data = await clientFrom(cmd).resource.query(
      id,
      resourceQueryOptionsFrom(opts, DEFAULT_QUERY_LIMIT),
    );
    printJson(data, outputOptions(cmd));
  });

  cmd
    .command("delete <id>")
    .description("Delete a resource")
    .option("-y, --yes", "skip confirmation")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).resource.delete(id), outputOptions(cmd));
    });

  groupChildren(cmd, {
    READ: ["list", "find", "get"],
    RUN: ["query"],
    WRITE: ["enable", "disable", "delete"],
  });

  return group(cmd, "DATA & KNOWLEDGE");
}
