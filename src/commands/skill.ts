// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn skill …` — skill registry and market. */
import { Command } from "commander";
import { group, groupChildren, guide } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { parseBigIntJSON } from "../utils/json-bigint.js";
import { printJson } from "../utils/output.js";
import { classifyPath, filesUnder, renderTree } from "../utils/skill-tree.js";
import { clientFrom, outputOptions, readBody } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

/**
 * A bare `parseInt` turns a typo into `NaN`, which is worse than an error:
 * `JSON.stringify` writes it to the wire as `null` (not "absent"), and Node
 * clamps a `NaN` setTimeout delay to 1ms, so the request aborts almost
 * immediately with a message about nothing the user typed.
 */
const positiveInt = (flag: string) => (v: string) => {
  // Digits only: `parseInt` stops at the first non-digit, so `1e3` would become
  // 1 and `30abc` would become 30 — a silently different limit rather than an
  // error, which is the failure this guard exists to prevent.
  if (!/^\d+$/.test(v)) {
    throw new InputError(`${flag} must be a positive integer (got '${v}')`);
  }
  const n = Number.parseInt(v, 10);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new InputError(`${flag} must be a positive integer (got '${v}')`);
  }
  return n;
};

/** A mocked run's own exit status, distinct from any the skill could return. */
const MOCKED_EXIT_CODE = 125;

/**
 * What `--exit-code` should hand back to the shell.
 *
 * A mocked run reports 0 because nothing failed — but nothing ran either, and
 * `skill execute … --exit-code && deploy` would take that as a green light.
 * Exit codes are also a single byte: a sandbox returning 256 would truncate to
 * 0 and read as success, so anything out of range becomes a plain 1.
 */
function sandboxExitCode(result: { mocked?: boolean; exit_code?: number } | undefined): number {
  if (result?.mocked) return MOCKED_EXIT_CODE;
  const code = result?.exit_code ?? 0;
  if (!Number.isSafeInteger(code) || code < 0) return 1;
  return code > 255 ? 1 : code;
}

/** Backend contract: `validate:"oneof=custom internal"`. */
const SKILL_SOURCES = ["custom", "internal"] as const;

function checkSource(source: string | undefined): string | undefined {
  if (source === undefined || (SKILL_SOURCES as readonly string[]).includes(source)) return source;
  throw new InputError(`--source must be one of: ${SKILL_SOURCES.join(" | ")} (got '${source}')`);
}

/** `--draft` reads the editable draft; without it, reads target the release. */
const draftOption = (c: Command) =>
  c.option("--draft", "read the draft (management) version instead of the published one");

export function skillCommand(): Command {
  const cmd = new Command("skill").description(
    "Skill packages (SKILL.md + files) agents load on demand",
  );

  const listOpts = (c: Command) =>
    c
      .option("--name <s>", "filter by name")
      .option("--source <s>", "filter by source")
      .option("--status <s>", "filter by status")
      .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
      .option("--page <n>", "page", int, 1);

  listOpts(
    cmd.command("list").description("List skills → {data, total, page, page_size, has_next}"),
  )
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

  draftOption(cmd.command("content <skill-id>"))
    .description("Read a skill's SKILL.md content index")
    .option("--raw", "write SKILL.md's own text instead of the index JSON")
    .action(async (id: string, opts, cmd: Command) => {
      const skills = clientFrom(cmd).skills;
      if (opts.raw) {
        process.stdout.write(await skills.contentRaw(id, { draft: opts.draft }));
        return;
      }
      printJson(await skills.content(id, { draft: opts.draft }), outputOptions(cmd));
    });

  draftOption(cmd.command("read-file <skill-id> <rel-path>"))
    .description("Read a file inside a skill (progressive)")
    .option("--raw", "write the file's own text instead of the response JSON")
    .action(async (id: string, relPath: string, opts, cmd: Command) => {
      const skills = clientFrom(cmd).skills;
      if (opts.raw) {
        process.stdout.write(await skills.readFileRaw(id, relPath, { draft: opts.draft }));
        return;
      }
      printJson(await skills.readFile(id, relPath, { draft: opts.draft }), outputOptions(cmd));
    });

  draftOption(cmd.command("files <skill-id> [path]"))
    .description("List a skill's files (one level; --tree for the whole hierarchy)")
    .option("--tree", "render the full hierarchy instead of one level")
    .action(async (id: string, path: string | undefined, opts, cmd: Command) => {
      const skills = clientFrom(cmd).skills;
      const out = outputOptions(cmd);
      if (opts.tree) {
        // `[path]` narrows the tree the same way it narrows the listing —
        // rendering the whole manifest here would answer a question the user
        // did not ask, without saying it had.
        const all = await skills.fileManifest(id, { draft: opts.draft });
        if (path !== undefined) {
          const kind = classifyPath(all, path);
          if (kind === "file")
            throw new InputError(`'${path}' is a file — use \`skill read-file\`.`);
          if (kind === "missing") throw new InputError(`'${path}' not found in skill ${id}.`);
        }
        const files = filesUnder(all, path);
        const bytes = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
        if (out.json || out.compact) {
          // A tree is a flat file list rather than one level of children, so
          // `files` is not `entries`. The envelope and the key casing still
          // match the listing, so a script can read both the same way.
          printJson(
            {
              skillId: id,
              path: path ?? "",
              files: files.map((f) => ({
                relPath: f.rel_path,
                fileType: f.file_type,
                size: f.size,
                mime: f.mime_type,
              })),
              totalFiles: files.length,
              totalSize: bytes,
            },
            out,
          );
          return;
        }
        process.stdout.write(`${renderTree(files)}\n\n${files.length} files, ${bytes} B\n`);
        return;
      }
      const listing = await skills.files(id, path, { draft: opts.draft });
      if (out.json || out.compact) {
        printJson(listing, out);
        return;
      }
      printJson(
        listing.entries.map((e) =>
          e.type === "dir"
            ? { name: `${e.name}/`, type: "dir", size: e.size, mime: "" }
            : { name: e.name, type: e.fileType ?? "file", size: e.size, mime: e.mime ?? "" },
        ),
        out,
      );
      process.stdout.write(
        `${listing.entries.length} entries here; ${listing.totalFiles} files, ${listing.totalSize} B below\n`,
      );
    });

  cmd
    .command("names <ids...>")
    .description("Resolve skill ids to names (unknown ids are skipped)")
    .action(async (ids: string[], _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).skills.names(ids), outputOptions(cmd));
    });

  cmd
    .command("execute <skill-id>")
    .description("Run a skill in the platform sandbox")
    .requiredOption("--entry <shell>", "shell command to run inside the skill's work dir")
    // No default here on purpose: with one, `opts.timeout` is never undefined
    // and the "omit it and the backend decides" path is unreachable from the
    // CLI, which would silently pin every run to our number instead of theirs.
    .option(
      "--timeout <seconds>",
      "sandbox time limit (the sandbox's own limit when omitted)",
      positiveInt("--timeout"),
    )
    .option("--raw", "write the run's stdout/stderr straight through")
    .option("--exit-code", "exit with the sandbox's exit code")
    .action(async (id: string, opts, cmd: Command) => {
      const result = await clientFrom(cmd).skills.execute(id, {
        entryShell: opts.entry,
        timeout: opts.timeout,
      });
      // A mocked run never touched the skill's code; saying so on stderr keeps
      // it out of a piped `--raw` capture while still reaching a human.
      if (result?.mocked) {
        process.stderr.write("warning: sandbox reported mocked=true — the skill did not run\n");
      }
      if (opts.raw) {
        if (result?.stdout) process.stdout.write(result.stdout);
        if (result?.stderr) process.stderr.write(result.stderr);
      } else {
        printJson(result, outputOptions(cmd));
      }
      if (opts.exitCode) process.exitCode = sandboxExitCode(result);
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
    .option("--source <s>", `source tag: ${SKILL_SOURCES.join(" | ")}`, "custom")
    .option("--extend-info <json>", "extra metadata as JSON")
    .action(async (dir: string, opts, cmd: Command) => {
      const extendInfo = opts.extendInfo ? parseBigIntJSON(opts.extendInfo) : undefined;
      printJson(
        await clientFrom(cmd).skills.register(dir, {
          source: checkSource(opts.source),
          extendInfo,
        }),
        outputOptions(cmd),
      );
    });
  draftOption(cmd.command("download <skill-id> [out-path]"))
    .description("Download a skill archive to a local .zip")
    .action(async (skillId: string, outPath: string | undefined, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).skills.download(skillId, outPath, { draft: opts.draft }),
        outputOptions(cmd),
      );
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
    .option(
      "--body <json>",
      "metadata JSON — docs: https://openbkn-ai.github.io/bkn-foundry/ (execution-factory)",
    )
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

  groupChildren(cmd, {
    READ: [
      "list",
      "market",
      "get",
      "market-get",
      "names",
      "content",
      "read-file",
      "files",
      "history",
    ],
    RUN: ["execute", "download", "install"],
    WRITE: [
      "register",
      "update-metadata",
      "update-package",
      "set-status",
      "republish",
      "publish-history",
      "delete",
    ],
  });

  guide(
    cmd,
    `READING A SKILL
  content <id> gives the SKILL.md index; files <id> [path] walks the package; read-file
  pulls one file. Read progressively — do not download the whole archive to answer a question.

PUBLISHED VS DRAFT
  Read commands return the published version. --draft reads the editing copy instead, which
  is what a Studio user sees. The two differ whenever changes are unpublished.

AUTHORING
  register <dir> zips and registers; update-package replaces the files; update-metadata
  changes only the metadata. set-status and republish move versions around.`,
  );
  return group(cmd, "TOOLS & SKILLS");
}
