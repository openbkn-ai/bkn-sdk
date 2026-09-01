// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn context …` (alias of legacy context-loader) — MCP retrieval. */
import { Command } from "commander";
import { readPlatformConfig, updatePlatformConfig } from "../config/store.js";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { printJson } from "../utils/output.js";
import { clientFrom, conversationSource, outputOptions, platformOf } from "./_shared.js";

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
      out = parseBigIntJSON(opts.args) as Record<string, unknown>;
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
      out[key] = parseBigIntJSON(raw);
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
    "Ask a network questions (the MCP interface agents use)",
  );

  const jsonArgs = (raw: string | undefined): Record<string, unknown> => {
    if (!raw) throw new InputError("--args is required (run with --schema to see its shape)");
    try {
      return parseBigIntJSON(raw) as Record<string, unknown>;
    } catch {
      throw new InputError("--args must be valid JSON");
    }
  };
  cmd
    .command("search-schema <kn-id> <query>")
    .description(
      "Search object/relation/action/metric schemas → {object_types, relation_types, action_types, metric_types}",
    )
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
    .description(
      'Query one object type\'s instances — `--args \'{"ot_id":"<id>","limit":10}\'` → {datas, total_count}',
    )
    .option(
      "--args <json>",
      "tool arguments as JSON; kn_id is filled from <kn-id>; --schema prints the shape",
    )
    .option("--schema", "print this tool's argument schema from the deploy instead of calling it")
    .action(async (knId: string, opts, cmd: Command) => {
      if (opts.schema) return printToolSchema(cmd, knId, "query_object_instance");
      const args = jsonArgs(opts.args);
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
    .command("conversation")
    .description("Show the remembered conversation, or forget it with --forget")
    .option(
      "--forget",
      "drop it, so the next command opens a fresh conversation (acts on this machine's store for the active user, whatever identity the request would use)",
    )
    .action((opts, cmd: Command) => {
      const o = cmd.optsWithGlobals();
      const baseUrl = platformOf(o);
      if (!baseUrl) throw new InputError("No platform. Run `openbkn auth login` first.");
      // Read before dropping, so the output can name what was dropped. With a
      // flag or env var in force the rest of this payload is identical to a
      // plain read, and `storedConversationId` is gone by then — without this,
      // `--forget` would be indistinguishable from doing nothing.
      const forgot = opts.forget ? readPlatformConfig(baseUrl).conversationId : undefined;
      if (opts.forget) {
        updatePlatformConfig(baseUrl, {
          conversationId: undefined,
          conversationOpenedAt: undefined,
        });
      }
      // The same resolution the next command will run, not a second copy of it:
      // this command exists to explain a surprise, so it must not be able to
      // disagree with what actually happens. `--new-conversation` and a
      // transient `--user` both report `none`, because that is what they cause.
      // That holds after `--forget` too: dropping what was stored does not
      // silence a `--conversation-id` or `BKN_CONVERSATION_ID` still in force,
      // and reporting `null` there would state the opposite. One shape for both
      // branches, for the same reason.
      const { id, source } = conversationSource(o);
      const stored = readPlatformConfig(baseUrl);
      printJson(
        {
          baseUrl,
          conversationId: id ?? null,
          source,
          ...(stored.conversationOpenedAt ? { storedOpenedAt: stored.conversationOpenedAt } : {}),
          // What is on disk, even when something outranks it — otherwise
          // `--forget` looks like a no-op to whoever just ran this.
          ...(stored.conversationId && stored.conversationId !== id
            ? { storedConversationId: stored.conversationId }
            : {}),
          ...(opts.forget ? { forgot: forgot ?? null } : {}),
        },
        outputOptions(cmd),
      );
    });

  cmd
    .command("info")
    .description("List the deploy's MCP tool catalog (global — no KN needed)")
    .action(async (_opts, cmd: Command) => {
      printToolList(await clientFrom(cmd).context.info(), outputOptions(cmd));
    });

  /**
   * The deploy is the only honest source for a tool's argument shape, so
   * `--schema` fetches it rather than restating it here, where it would drift.
   */
  const printToolSchema = async (cmd: Command, knId: string, tool: string): Promise<void> => {
    const listed = (await clientFrom(cmd).context.tools(knId)) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
    };
    const found = listed.tools?.find((t) => t.name === tool);
    if (!found) throw new InputError(`this deploy does not advertise the ${tool} tool`);
    printJson(
      { tool: found.name, description: found.description, inputSchema: found.inputSchema },
      { ...outputOptions(cmd), json: true },
    );
  };

  cmd
    .command("run-sql <kn-id>")
    .description(
      "Aggregate, rank or join with read-only SQL — what query-object-instance cannot do",
    )
    // Not a requiredOption: `--schema` is a valid call that sends no SQL at all.
    .option("--sql <sql>", "read-only MySQL over data resources, tables named as {{<resource-id>}}")
    .option("--timeout <sec>", "query timeout in seconds", (v) => Number.parseInt(v, 10))
    .option("--schema", "print this tool's argument schema from the deploy instead of calling it")
    .addHelpText(
      "after",
      `
A table is named by resource id, never by the name it carries on the source:

  openbkn context search-schema <kn-id> "<what you are after>" --json
      → object_types[].data_source.id

  openbkn context run-sql <kn-id> \\
    --sql "SELECT supplier_id, COUNT(*) c FROM {{d9g387peef0be1ifnurg}} GROUP BY supplier_id"

Joining two resources means two ids, one placeholder each. Column names are the
physical ones. Answers {columns, entries, paging} plus a bkn_receipt recording
the operation in BKN Trace. Row limits belong in the SQL — this tool takes no
limit argument.

The same SQL runs without a knowledge network through \`openbkn vega sql\`, which
adds paging and --need-total but records nothing in Trace.`,
    )
    .action(async (knId: string, opts, cmd: Command) => {
      if (opts.schema) return printToolSchema(cmd, knId, "run_sql");
      if (!opts.sql) throw new InputError("--sql is required (or use --schema to see the shape)");
      const args: Record<string, unknown> = { sql: opts.sql };
      if (opts.timeout !== undefined) args.query_timeout = opts.timeout;
      printJson(await clientFrom(cmd).context.toolCall(knId, "run_sql", args), outputOptions(cmd));
    });

  cmd
    .command("explore-subgraph <kn-id> <object-type-id>")
    .description("Follow relations outward from one object type without naming a path first")
    // Same reason as run-sql: `--schema` answers without walking anything.
    .option("--hops <n>", "how many hops to walk, 1-3", (v) => Number.parseInt(v, 10))
    .option(
      "--direction <d>",
      "forward | backward | bidirectional — pick bidirectional when unsure how the relation reads",
      "bidirectional",
    )
    .option("--limit <n>", "instances of the STARTING type, not paths or total objects", (v) =>
      Number.parseInt(v, 10),
    )
    .option("--args <json>", "extra tool arguments merged in (condition, sort, offset …)")
    .option("--schema", "print this tool's argument schema from the deploy instead of calling it")
    .addHelpText(
      "after",
      `
Use this when the topology is the question — "what does this supplier touch?" —
and \`query-instance-subgraph\` when you already know which relations to walk.
Paths multiply with each hop, so start at 1 or 2.`,
    )
    .action(async (knId: string, objectTypeId: string, opts, cmd: Command) => {
      if (opts.schema) return printToolSchema(cmd, knId, "explore_subgraph");
      if (opts.hops === undefined) {
        throw new InputError("--hops is required (or use --schema to see the shape)");
      }
      const args: Record<string, unknown> = {
        ...(opts.args ? jsonArgs(opts.args) : {}),
        source_object_type_id: objectTypeId,
        direction: opts.direction,
        path_length: opts.hops,
      };
      if (opts.limit !== undefined) args.limit = opts.limit;
      printJson(
        await clientFrom(cmd).context.toolCall(knId, "explore_subgraph", args),
        outputOptions(cmd),
      );
    });

  cmd
    .command("query-metric <kn-id> <metric-id>")
    .description("Read a modelled metric through its own definition — do not restate it in SQL")
    .option(
      "--args <json>",
      "tool arguments: analysis_dimensions, time, condition, having, order_by",
    )
    .option("--schema", "print this tool's argument schema from the deploy instead of calling it")
    .addHelpText(
      "after",
      `
Metric ids come from an object type: \`context object-types <kn-id> <ot-id>\`
lists them under related_metrics. The definition owns the arithmetic, so
rewriting it with \`run-sql\` produces a number the platform will not agree with.`,
    )
    .action(async (knId: string, metricId: string, opts, cmd: Command) => {
      if (opts.schema) return printToolSchema(cmd, knId, "query_metric");
      const args = { ...(opts.args ? jsonArgs(opts.args) : {}), metric_id: metricId };
      printJson(
        await clientFrom(cmd).context.toolCall(knId, "query_metric", args),
        outputOptions(cmd),
      );
    });

  cmd
    .command("tools <kn-id>")
    .description("List MCP tools advertised for a KN session → {tools} with each inputSchema")
    .action(async (knId: string, _opts, cmd: Command) => {
      printToolList(await clientFrom(cmd).context.tools(knId), outputOptions(cmd));
    });

  cmd
    .command("tool-call <kn-id> <name>")
    .description("Call any MCP tool by name — current or future (use `tools` to discover)")
    .option(
      "--args <json>",
      "tool arguments as JSON; kn_id is filled from <kn-id> — input schema comes from `context tools <kn-id>`",
    )
    .option(
      "--arg <key=value>",
      "one argument (repeatable; value parsed as JSON, else string)",
      collectArg,
      [],
    )
    .option(
      "--schema",
      "print the named tool's argument schema from the deploy instead of calling it",
    )
    .option("--receipt", "return the validated operation receipt (requires --json)")
    .action(async (knId: string, name: string, opts, cmd: Command) => {
      if (opts.receipt && opts.schema) {
        throw new InputError("--receipt cannot be combined with --schema");
      }
      if (opts.receipt && !cmd.optsWithGlobals().json) {
        throw new InputError("--receipt requires --json");
      }
      if (opts.schema) return printToolSchema(cmd, knId, name);
      if (opts.receipt) {
        const { value, receipt } = await clientFrom(cmd).context.managedToolCall(
          knId,
          name,
          buildArgs(opts),
        );
        printJson({ value, bkn_receipt: receipt }, { ...outputOptions(cmd), json: true });
        return;
      }
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
    .option("--args <json>", "method params as JSON — see `context call-method <kn-id> tools/list`")
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
    .option(
      "--args <json>",
      "prompt arguments as JSON — argument names come from `context prompts <kn-id>`",
    )
    .action(async (knId: string, name: string, opts, cmd: Command) => {
      let args: Record<string, unknown> | undefined;
      if (opts.args) {
        try {
          args = parseBigIntJSON(opts.args) as Record<string, unknown>;
        } catch {
          throw new InputError("--args must be valid JSON");
        }
      }
      printJson(await clientFrom(cmd).context.prompt(knId, name, args), outputOptions(cmd));
    });

  cmd
    .command("query-instance-subgraph <kn-id>")
    .description("Query an instance subgraph across relation-type paths")
    .option(
      "--args <json>",
      "tool arguments as JSON; kn_id is filled from <kn-id>; --schema prints the shape",
    )
    .option("--schema", "print this tool's argument schema from the deploy instead of calling it")
    .action(async (knId: string, opts, cmd: Command) => {
      if (opts.schema) return printToolSchema(cmd, knId, "query_instance_subgraph");
      printJson(
        await clientFrom(cmd).context.queryInstanceSubgraph(knId, jsonArgs(opts.args)),
        outputOptions(cmd),
      );
    });
  cmd
    .command("get-logic-properties <kn-id>")
    .description("Compute logic-property values for instances")
    .option(
      "--args <json>",
      "tool arguments as JSON; kn_id is filled from <kn-id>; --schema prints the shape",
    )
    .option("--schema", "print this tool's argument schema from the deploy instead of calling it")
    .action(async (knId: string, opts, cmd: Command) => {
      if (opts.schema) return printToolSchema(cmd, knId, "get_logic_properties_values");
      printJson(
        await clientFrom(cmd).context.logicProperties(knId, jsonArgs(opts.args)),
        outputOptions(cmd),
      );
    });
  cmd
    .command("get-action-info <kn-id>")
    .description("Fetch action info / dynamic tools for an instance")
    .option(
      "--args <json>",
      "tool arguments as JSON; kn_id is filled from <kn-id>; --schema prints the shape",
    )
    .option("--schema", "print this tool's argument schema from the deploy instead of calling it")
    .action(async (knId: string, opts, cmd: Command) => {
      if (opts.schema) return printToolSchema(cmd, knId, "get_action_info");
      printJson(
        await clientFrom(cmd).context.actionInfo(knId, jsonArgs(opts.args)),
        outputOptions(cmd),
      );
    });

  groupChildren(cmd, {
    GROUPS: ["conversation"],
    READ: [
      "search-schema",
      "kn-detail",
      "object-types",
      "relation-types",
      "info",
      "tools",
      "resources",
      "resource",
      "templates",
      "prompts",
      "prompt",
      "find-skills",
    ],
    RUN: [
      "query-object-instance",
      "run-sql",
      "explore-subgraph",
      "query-metric",
      "query-instance-subgraph",
      "get-logic-properties",
      "get-action-info",
      "tool-call",
      "call-method",
    ],
  });

  guide(
    cmd,
    `ORDER OF WORK
  1. search-schema <kn-id> "<question>"     find the object/relation/action ids that matter
  2. kn-detail / object-types               drill into the ones you picked
  3. query-object-instance                  filter + sort + page one object type
     query-instance-subgraph                follow a known relation path
     get-logic-properties / get-action-info  computed values, runnable actions

PICKING THE RIGHT QUERY
  Aggregation, ranking, GROUP BY or joins are not query-object-instance — send SQL through
  \`tool-call <kn-id> run_sql\`. Unknown topology is \`tool-call <kn-id> explore_subgraph\`,
  not a hand-built path.

THE SAME ID, FOUR NAMES
  An object type's id is \`concept_id\` in search-schema output, \`id\` in kn-detail and
  get_object_types, \`ot_id\` in query-object-instance arguments, and \`object_type_id\` on
  an instance row. Same value throughout — carry it across, do not look it up again.

RAW MCP
  tools <kn-id> lists what this deploy advertises, with each tool's input schema.
  tool-call / call-method reach anything the named commands above do not cover.`,
  );
  return group(cmd, "DATA & KNOWLEDGE");
}
