/** `openbkn skill …` — skill registry and market. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions, readBody } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

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

  cmd
    .command("content <skill-id>")
    .description("Read a skill's SKILL.md content index")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).skills.content(id), outputOptions(cmd));
    });

  cmd
    .command("read-file <skill-id> <rel-path>")
    .description("Read a file inside a skill (progressive)")
    .action(async (id: string, relPath: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).skills.readFile(id, relPath), outputOptions(cmd));
    });

  cmd
    .command("history <skill-id>")
    .description("Show a skill's version history")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).skills.history(id), outputOptions(cmd));
    });

  cmd
    .command("set-status <skill-id> <status>")
    .description("Change status: unpublish | published | offline")
    .action(async (id: string, status: string, _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).skills.setStatus(id, status as "unpublish" | "published" | "offline"),
        outputOptions(cmd),
      );
    });

  cmd
    .command("register <directory>")
    .description("Zip a local skill directory and register it")
    .option("--source <s>", "source tag")
    .option("--extend-info <json>", "extra metadata as JSON")
    .action(async (dir: string, opts, cmd: Command) => {
      const extendInfo = opts.extendInfo ? JSON.parse(opts.extendInfo) : undefined;
      printJson(
        await clientFrom(cmd).skills.register(dir, { source: opts.source, extendInfo }),
        outputOptions(cmd),
      );
    });
  cmd
    .command("download <skill-id> [out-path]")
    .description("Download a skill archive to a local .zip")
    .action(async (skillId: string, outPath: string | undefined, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).skills.download(skillId, outPath), outputOptions(cmd));
    });
  cmd
    .command("install <skill-id> [directory]")
    .description("Download a skill archive and extract it locally")
    .action(async (skillId: string, dir: string | undefined, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).skills.install(skillId, dir), outputOptions(cmd));
    });
  cmd
    .command("update-metadata <skill-id>")
    .description("Update a skill's metadata (--body / --body-file JSON)")
    .option("--body <json>", "metadata JSON")
    .option("--body-file <path>", "read metadata JSON from a file")
    .action(async (skillId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).skills.updateMetadata(skillId, readBody(opts)),
        outputOptions(cmd),
      );
    });
  cmd
    .command("update-package <skill-id> <directory>")
    .description("Replace a skill's package from a local directory")
    .action(async (skillId: string, dir: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).skills.updatePackage(skillId, dir), outputOptions(cmd));
    });

  cmd
    .command("republish <skill-id>")
    .description("Republish a previous skill version")
    .requiredOption("--version <v>", "version to republish")
    .action(async (skillId: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).skills.republish(skillId, opts.version), outputOptions(cmd));
    });
  cmd
    .command("publish-history <skill-id>")
    .description("Publish a historical skill version")
    .requiredOption("--version <v>", "version to publish")
    .action(async (skillId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).skills.publishHistory(skillId, opts.version),
        outputOptions(cmd),
      );
    });

  return group(cmd, "MODELS & SKILLS");
}
