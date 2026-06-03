/** `openbkn skill …` — skill registry and market. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

function notImplemented(path: string): () => never {
  return () => {
    throw new Error(`\`openbkn skill ${path}\` is not implemented yet.`);
  };
}

export function skillCommand(): Command {
  const cmd = new Command("skill").description("Skill registry and market");

  const listOpts = (c: Command) =>
    c
      .option("--name <s>", "filter by name")
      .option("--source <s>", "filter by source")
      .option("--status <s>", "filter by status")
      .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
      .option("--page <n>", "page", int, 1);

  listOpts(cmd.command("list").description("List skills"))
    .option("--create-user <s>", "filter by creator")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).skills.list({
          name: opts.name,
          source: opts.source,
          status: opts.status,
          createUser: opts.createUser,
          pageSize: opts.limit,
          page: opts.page,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("get <skill-id>")
    .description("Get a skill by id")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).skills.get(id), outputOptions(cmd));
    });

  listOpts(cmd.command("market").description("Browse the skill market")).action(
    async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).skills.market({
          name: opts.name,
          source: opts.source,
          pageSize: opts.limit,
          page: opts.page,
        }),
        outputOptions(cmd),
      );
    },
  );

  cmd
    .command("market-get <skill-id>")
    .description("Get a market skill by id")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).skills.marketGet(id), outputOptions(cmd));
    });

  cmd
    .command("delete <skill-id>")
    .description("Delete a skill")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).skills.delete(id), outputOptions(cmd));
    });

  // Package/content/lifecycle ops need multipart + body contracts (deferred).
  for (const name of [
    "register",
    "set-status",
    "download",
    "install",
    "content",
    "read-file",
    "update-metadata",
    "update-package",
    "history",
    "republish",
    "publish-history",
  ]) {
    cmd
      .command(name)
      .description(`${name} (pending)`)
      .allowUnknownOption()
      .action(notImplemented(name));
  }

  return group(cmd, "MODELS & SKILLS");
}
