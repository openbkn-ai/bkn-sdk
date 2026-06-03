/** `openbkn bkn …` — knowledge networks (kept identical to legacy `kweaver bkn`). */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

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
    ["object-type", "objectTypes", ["get", "create", "update", "delete", "query", "properties"]],
    ["relation-type", "relationTypes", ["get", "create", "update", "delete"]],
    ["action-type", "actionTypes", ["get", "query", "inputs", "execute"]],
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

  // Remaining subcommands kept in the tree as stubs (filled in incrementally).
  for (const name of [
    "create",
    "create-from-catalog",
    "create-from-csv",
    "update",
    "delete",
    "stats",
    "export",
    "validate",
    "push",
    "pull",
    "subgraph",
    "resources",
    "relation-type-paths",
    "concept-group",
    "metric",
    "action-execution",
    "action-log",
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
