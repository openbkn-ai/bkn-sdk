// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn context …` (alias of legacy context-loader) — MCP retrieval. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);
const collectArg = (v: string, prev: string[]): string[] => {
  prev.push(v);
  return prev;
};

/**
 * Build a tool/method argument object from `--args <json>` and/or repeatable
 * `--arg key=value`. `--arg` values are parsed as JSON (so numbers, booleans,
 * and arrays work) and fall back to a raw string. `--arg` overrides `--args`.
 * This is the generic path: any MCP tool — current or future — is callable
 * without a hand-written wrapper.
 */
function buildArgs(opts: { args?: string; arg?: string[] }): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  if (opts.args) {
    try {
      out = JSON.parse(opts.args);
    } catch {
      throw new InputError("--args must be valid JSON");
    }
  }
  for (const pair of opts.arg ?? []) {
    const idx = pair.indexOf("=");
    if (idx <= 0) throw new InputError(`--arg must be key=value (got: ${pair})`);
    const key = pair.slice(0, idx);
    const raw = pair.slice(idx + 1);
    try {
      out[key] = JSON.parse(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * Render an MCP tool catalog (`info` / `tools`). Default view is a readable
 * table of name + description; `--json`/`--compact` emit the raw response. The
 * tools array is dug out of the common envelope shapes; an unrecognised shape
 * falls back to raw JSON so nothing is hidden.
 */
function printToolList(res: unknown, out: { json?: boolean; compact?: boolean }): void {
  if (out.json || out.compact) {
    printJson(res, out);
    return;
  }
  const r = (res ?? {}) as { tools?: unknown; result?: { tools?: unknown }; data?: unknown };
  const arr = [res, r.tools, r.result?.tools, r.data].find(Array.isArray) as
    | Array<Record<string, unknown>>
    | undefined;
  if (!arr) {
    printJson(res, out);
    return;
  }
  const rows = arr.map((t) => ({
    name: t.name ?? t.tool_name ?? t.key ?? "",
    description: typeof t.description === "string" ? t.description : "",
  }));
  printJson(rows, out);
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
    .command("kn-detail <kn-id>")
    .description("Get a KN's schema at a detail level (progressive: summary skeleton → drill down)")
    .option("--detail-level <level>", "summary (default) | full", "summary")
    .action(async (knId: string, opts, cmd: Command) => {
      const level = opts.detailLevel === "full" ? "full" : "summary";
      printJson(await clientFrom(cmd).context.knDetail(knId, level), outputOptions(cmd));
    });

  cmd
    .command("object-types <kn-id> <ids...>")
    .description("Full definitions for the given object-type ids (unmatched → `missing`)")
    .action(async (knId: string, ids: string[], _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).context.objectTypes(knId, ids), outputOptions(cmd));
    });

  cmd
    .command("relation-types <kn-id> <ids...>")
    .description("Full definitions for the given relation-type ids (unmatched → `missing`)")
    .action(async (knId: string, ids: string[], _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).context.relationTypes(knId, ids), outputOptions(cmd));
    });

  cmd
    .command("info")
    .description("List the deploy's MCP tool catalog (global — no KN needed)")
    .action(async (_opts, cmd: Command) => {
      printToolList(await clientFrom(cmd).context.info(), outputOptions(cmd));
    });

  cmd
    .command("tools <kn-id>")
    .description("List MCP tools advertised for a KN session")
    .action(async (knId: string, _opts, cmd: Command) => {
      printToolList(await clientFrom(cmd).context.tools(knId), outputOptions(cmd));
    });

  cmd
    .command("tool-call <kn-id> <name>")
    .description("Call any MCP tool by name — current or future (use `tools` to discover)")
    .option("--args <json>", "tool arguments as JSON")
    .option(
      "--arg <key=value>",
      "one argument (repeatable; value parsed as JSON, else string)",
      collectArg,
      [],
    )
    .action(async (knId: string, name: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).context.toolCall(knId, name, buildArgs(opts)),
        outputOptions(cmd),
      );
    });

  cmd
    .command("call-method <kn-id> <method>")
    .description(
      "Call any MCP method by name (e.g. tools/list, resources/read) — current or future",
    )
    .option("--args <json>", "method params as JSON")
    .option(
      "--arg <key=value>",
      "one param (repeatable; value parsed as JSON, else string)",
      collectArg,
      [],
    )
    .action(async (knId: string, method: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).context.callMethod(knId, method, buildArgs(opts)),
        outputOptions(cmd),
      );
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
    .description("Query an instance subgraph across relation-type paths")
    .requiredOption("--args <json>", "tool arguments as JSON")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).context.queryInstanceSubgraph(knId, jsonArgs(opts.args)),
        outputOptions(cmd),
      );
    });
  cmd
    .command("get-logic-properties <kn-id>")
    .description("Compute logic-property values for instances")
    .requiredOption("--args <json>", "tool arguments as JSON")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).context.logicProperties(knId, jsonArgs(opts.args)),
        outputOptions(cmd),
      );
    });
  cmd
    .command("get-action-info <kn-id>")
    .description("Fetch action info / dynamic tools for an instance")
    .requiredOption("--args <json>", "tool arguments as JSON")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).context.actionInfo(knId, jsonArgs(opts.args)),
        outputOptions(cmd),
      );
    });

  return group(cmd, "AI DATA PLATFORM");
}
