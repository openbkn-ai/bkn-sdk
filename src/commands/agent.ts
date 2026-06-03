/** `openbkn agent …` — decision agents (read side + listings). */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

function notImplemented(path: string): () => never {
  return () => {
    throw new Error(`\`openbkn agent ${path}\` is not implemented yet.`);
  };
}

export function agentCommand(): Command {
  const cmd = new Command("agent").description("Agent CRUD, chat, sessions, publish");

  cmd
    .command("list")
    .description("List published agents")
    .option("--name <s>", "filter by name")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .option("--category-id <id>", "filter by category")
    .action(async (opts, cmd: Command) => {
      const data = await clientFrom(cmd).agents.list({
        name: opts.name,
        limit: opts.limit,
        offset: opts.offset,
        categoryId: opts.categoryId,
      });
      printJson(data, outputOptions(cmd));
    });

  cmd
    .command("personal-list")
    .description("List personal-space agents")
    .option("--name <s>", "filter by name")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .action(async (opts, cmd: Command) => {
      const data = await clientFrom(cmd).agents.personalList({
        name: opts.name,
        limit: opts.limit,
        offset: opts.offset,
      });
      printJson(data, outputOptions(cmd));
    });

  cmd
    .command("category-list")
    .description("List agent categories")
    .action(async (_opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.categoryList(), outputOptions(cmd));
    });

  cmd
    .command("template-list")
    .description("List published agent templates")
    .option("--name <s>", "filter by name")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--offset <n>", "page offset", int, 0)
    .action(async (opts, cmd: Command) => {
      const data = await clientFrom(cmd).agents.templateList({
        name: opts.name,
        limit: opts.limit,
        offset: opts.offset,
      });
      printJson(data, outputOptions(cmd));
    });

  cmd
    .command("template-get <id>")
    .description("Get a published agent template")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.templateGet(id), outputOptions(cmd));
    });

  cmd
    .command("get <id>")
    .description("Get agent details")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.get(id), outputOptions(cmd));
    });

  cmd
    .command("get-by-key <key>")
    .description("Get an agent by key")
    .action(async (key: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.getByKey(key), outputOptions(cmd));
    });

  // Write ops + chat/sessions/history kept as stubs (conversation + mutation
  // contracts handled in a later slice).
  for (const name of [
    "create",
    "update",
    "delete",
    "publish",
    "unpublish",
    "chat",
    "sessions",
    "history",
    "trace",
    "skill",
  ]) {
    cmd
      .command(name)
      .description(`${name} (pending)`)
      .allowUnknownOption()
      .action(notImplemented(name));
  }

  return group(cmd, "DECISION AGENT");
}
