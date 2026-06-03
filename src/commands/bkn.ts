/** `openbkn bkn …` — knowledge networks (kept identical to legacy `kweaver bkn`). */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions, readBody } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

function notImplemented(path: string): () => never {
  return () => {
    throw new Error(`\`openbkn bkn ${path}\` is not implemented yet.`);
  };
}

export function bknCommand(): Command {
  const bkn = new Command("bkn").description("Knowledge networks — list, query, schema, instances");

  bkn
    .command("list")
    .description("List knowledge networks")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--name-pattern <s>", "filter by name pattern")
    .option("--tag <s>", "filter by tag")
    .option("--sort <field>", "sort field", "update_time")
    .option("--direction <dir>", "asc | desc", "desc")
    .action(async (_opts, cmd: Command) => {
      const o = cmd.optsWithGlobals();
      const data = await clientFrom(cmd).kn.list({
        limit: o.limit,
        offset: o.offset,
        namePattern: o.namePattern,
        tag: o.tag,
        sort: o.sort,
        direction: o.direction,
      });
      printJson(data, outputOptions(cmd));
    });

  bkn
    .command("get <kn-id>")
    .description("Get a knowledge network (use --stats or --export)")
    .option("--stats", "include statistics")
    .option("--export", "return the full export payload")
    .action(async (knId: string, opts, cmd: Command) => {
      const data = await clientFrom(cmd).kn.get(knId, {
        stats: opts.stats,
        exportMode: opts.export,
      });
      printJson(data, outputOptions(cmd));
    });

  bkn
    .command("search <kn-id> <query>")
    .description("Semantic search within a knowledge network")
    .option("--max-concepts <n>", "max concepts to return", int, 10)
    .option("--mode <mode>", "retrieval mode", "keyword_vector_retrieval")
    .action(async (knId: string, query: string, opts, cmd: Command) => {
      const data = await clientFrom(cmd).kn.search(knId, query, {
        maxConcepts: opts.maxConcepts,
        mode: opts.mode,
      });
      printJson(data, outputOptions(cmd));
    });

  // Schema groups with a real `list` (read side); other actions stubbed.
  const schemaGroups: Array<[string, "objectTypes" | "relationTypes" | "actionTypes", string[]]> = [
    ["object-type", "objectTypes", ["get", "create", "update", "delete"]],
    ["relation-type", "relationTypes", ["get", "create", "update", "delete"]],
    ["action-type", "actionTypes", ["get", "inputs"]],
  ];
  for (const [name, method, stubs] of schemaGroups) {
    const g = bkn.command(name).description(`${name} list/get/...`);
    g.command("list <kn-id>")
      .description(`List ${name}s`)
      .option("--branch <b>", "branch", "main")
      .action(async (knId: string, opts, cmd: Command) => {
        printJson(
          await clientFrom(cmd).kn[method](knId, { branch: opts.branch }),
          outputOptions(cmd),
        );
      });
    for (const s of stubs) {
      g.command(s)
        .description(`${s} (pending)`)
        .allowUnknownOption()
        .action(notImplemented(`${name} ${s}`));
    }
  }

  // Real action-type query + execute on the action-type group.
  const actionType = bkn.commands.find((c) => c.name() === "action-type");
  actionType
    ?.command("query <kn-id> <at-id>")
    .description("Query an action type (--body / --body-file JSON)")
    .option("--body <json>", "query JSON")
    .option("--body-file <path>", "read query JSON from a file")
    .action(async (knId: string, atId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.actionTypeQuery(knId, atId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  actionType
    ?.command("execute <kn-id> <at-id>")
    .description("Execute an action type (--body / --body-file envelope JSON)")
    .option("--body <json>", "execution envelope JSON")
    .option("--body-file <path>", "read envelope JSON from a file")
    .action(async (knId: string, atId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.actionTypeExecute(knId, atId, readBody(opts)),
        outputOptions(cmd),
      );
    });

  // stats/export are aliases of `get --stats` / `get --export`.
  bkn
    .command("stats <kn-id>")
    .description("Get knowledge-network statistics (alias for get --stats)")
    .action(async (knId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.get(knId, { stats: true }), outputOptions(cmd));
    });
  bkn
    .command("export <kn-id>")
    .description("Export a knowledge network (alias for get --export)")
    .action(async (knId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.get(knId, { exportMode: true }), outputOptions(cmd));
    });

  // Real object-type instance query + properties (the rest are stubs above).
  const objectType = bkn.commands.find((c) => c.name() === "object-type");
  objectType
    ?.command("query <kn-id> <ot-id>")
    .description("Query instances of an object type (--body / --body-file JSON)")
    .option("--body <json>", "query JSON")
    .option("--body-file <path>", "read query JSON from a file")
    .action(async (knId: string, otId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.objectTypeQuery(knId, otId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  objectType
    ?.command("properties <kn-id> <ot-id>")
    .description("Get an object type's calculated properties")
    .action(async (knId: string, otId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.objectTypeProperties(knId, otId), outputOptions(cmd));
    });

  bkn
    .command("create <name>")
    .description("Create an (empty) knowledge network")
    .option("--branch <b>", "branch", "main")
    .action(async (name: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.create({ name, branch: opts.branch }), outputOptions(cmd));
    });

  bkn
    .command("update <kn-id>")
    .description("Update a knowledge network (--body / --body-file)")
    .option("--body <json>", "update body JSON")
    .option("--body-file <path>", "read update body JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.update(knId, readBody(opts)), outputOptions(cmd));
    });

  bkn
    .command("delete <kn-id>")
    .description("Delete a knowledge network")
    .option("-y, --yes", "skip confirmation")
    .action(async (knId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.delete(knId), outputOptions(cmd));
    });

  bkn
    .command("subgraph <kn-id>")
    .description("Query a subgraph (--body / --body-file JSON)")
    .option("--body <json>", "subgraph query JSON")
    .option("--body-file <path>", "read subgraph query JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.subgraph(knId, readBody(opts)), outputOptions(cmd));
    });

  const actionLog = bkn.command("action-log").description("Action logs — list/get/cancel");
  actionLog
    .command("list <kn-id>")
    .description("List action logs")
    .option("--status <s>", "filter by status")
    .option("--action-type-id <id>", "filter by action type")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.actionLogs(knId, {
          status: opts.status,
          actionTypeId: opts.actionTypeId,
          limit: opts.limit,
        }),
        outputOptions(cmd),
      );
    });
  actionLog
    .command("get <kn-id> <log-id>")
    .description("Get an action log")
    .action(async (knId: string, logId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.actionLog(knId, logId), outputOptions(cmd));
    });
  actionLog
    .command("cancel <kn-id> <log-id>")
    .description("Cancel a running action")
    .action(async (knId: string, logId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.cancelActionLog(knId, logId), outputOptions(cmd));
    });

  bkn
    .command("action-execution <kn-id> <execution-id>")
    .description("Get action execution status")
    .action(async (knId: string, execId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.actionExecution(knId, execId), outputOptions(cmd));
    });

  const metric = bkn.command("metric").description("Metrics — query / dry-run");
  metric
    .command("query <kn-id> <metric-id>")
    .description("Query a metric's data (--body / --body-file JSON)")
    .option("--body <json>", "query JSON")
    .option("--body-file <path>", "read query JSON from a file")
    .action(async (knId: string, metricId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).kn.metricQuery(knId, metricId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  metric
    .command("dry-run <kn-id>")
    .description("Dry-run a metric definition (--body / --body-file JSON)")
    .option("--body <json>", "metric definition JSON")
    .option("--body-file <path>", "read metric definition JSON from a file")
    .action(async (knId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).kn.metricDryRun(knId, readBody(opts)), outputOptions(cmd));
    });
  for (const s of ["list", "get", "create", "search", "validate", "update", "delete"]) {
    metric
      .command(s)
      .description(`${s} (pending)`)
      .allowUnknownOption()
      .action(notImplemented(`metric ${s}`));
  }

  // Remaining subcommands kept in the tree as stubs (filled in incrementally).
  for (const name of [
    "create-from-catalog",
    "create-from-csv",
    "validate",
    "push",
    "pull",
    "resources",
    "relation-type-paths",
    "concept-group",
    "action-schedule",
    "job",
  ]) {
    bkn
      .command(name)
      .description(`${name} (pending)`)
      .allowUnknownOption()
      .action(notImplemented(name));
  }

  return group(bkn, "AI DATA PLATFORM");
}
