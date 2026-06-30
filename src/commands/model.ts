/** `openbkn model …` — model factory (llm / small-model). */
import { Command } from "commander";
import type { BknClient } from "../client.js";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, csv, outputOptions, readBody } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

/**
 * `chat` resolves the model by NAME (the mf-model-api `model` field). Accept a
 * numeric id too — look up its name first — so it matches `get`/`set-default`,
 * which take ids. A non-numeric arg is assumed to already be a name.
 */
async function resolveLlmModelName(client: BknClient, model: string): Promise<string> {
  if (!/^\d+$/.test(model)) return model;
  const detail = (await client.models.llm.get(model)) as { model_name?: string };
  if (!detail?.model_name) throw new InputError(`No LLM found with id ${model}.`);
  return detail.model_name;
}

/** Management subcommands (add/edit/delete/test) wired to the model resource. */
function addManagementCommands(parent: Command, kind: "llm" | "small"): void {
  parent
    .command("add")
    .description("Register a model (definition JSON via --body / --body-file)")
    .option("--body <json>", "model definition JSON")
    .option("--body-file <path>", "read model definition JSON from a file")
    .action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).models[kind].add(readBody(opts)), outputOptions(cmd));
    });
  parent
    .command("edit")
    .description("Update a model definition (JSON via --body / --body-file)")
    .option("--body <json>", "model definition JSON")
    .option("--body-file <path>", "read model definition JSON from a file")
    .action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).models[kind].edit(readBody(opts)), outputOptions(cmd));
    });
  parent
    .command("delete <model-ids>")
    .description("Delete model(s) (comma-joined ids)")
    .action(async (ids: string, _o, cmd: Command) => {
      printJson(await clientFrom(cmd).models[kind].delete(csv(ids) ?? []), outputOptions(cmd));
    });
  parent
    .command("test")
    .description("Test a model's connectivity / inference (JSON via --body / --body-file)")
    .option("--body <json>", "test request JSON")
    .option("--body-file <path>", "read test request JSON from a file")
    .action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).models[kind].test(readBody(opts)), outputOptions(cmd));
    });
}

export function modelCommand(): Command {
  const model = new Command("model").description(
    "Model factory — LLM / small-model CRUD, chat / embeddings / rerank, default selection",
  );

  const llm = model.command("llm").description("Large language models");
  llm
    .command("list")
    .description("List LLM models")
    .option("--name <s>", "filter by name")
    .option("--type <t>", "model type filter")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--page <n>", "page", int, 1)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).models.llm.list({
          name: opts.name,
          modelType: opts.type,
          limit: opts.limit,
          page: opts.page,
        }),
        outputOptions(cmd),
      );
    });
  llm
    .command("get <modelId>")
    .description("Get an LLM model")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).models.llm.get(id), outputOptions(cmd));
    });
  llm
    .command("chat <model>")
    .description("OpenAI-compatible chat completion (<model> = model name or numeric id)")
    .requiredOption("-m, --message <text>", "user message")
    .option("--stream", "stream the reply token-by-token to stdout")
    .action(async (model: string, opts, cmd: Command) => {
      const client = clientFrom(cmd);
      const name = await resolveLlmModelName(client, model);
      const messages = [{ role: "user", content: opts.message }];
      if (opts.stream) {
        await client.models.llm.chatStream(name, messages, (t) => process.stdout.write(t));
        process.stdout.write("\n");
        return;
      }
      printJson(await client.models.llm.chat(name, messages), outputOptions(cmd));
    });
  llm
    .command("set-default <modelId>")
    .description("Set this LLM as the system default (admin)")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).models.llm.setDefault(id, true), outputOptions(cmd));
    });
  llm
    .command("unset-default <modelId>")
    .description("Clear this LLM as the system default (admin)")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).models.llm.setDefault(id, false), outputOptions(cmd));
    });
  addManagementCommands(llm, "llm");

  const small = model.command("small").description("Small models (embedding / reranker)");
  small
    .command("list")
    .description("List small models")
    .option("--name <s>", "filter by name")
    .option("--type <t>", "model type filter")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--page <n>", "page", int, 1)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).models.small.list({
          name: opts.name,
          modelType: opts.type,
          limit: opts.limit,
          page: opts.page,
        }),
        outputOptions(cmd),
      );
    });
  small
    .command("get <modelId>")
    .description("Get a small model")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).models.small.get(id), outputOptions(cmd));
    });
  small
    .command("embeddings <modelId>")
    .description("Compute embeddings")
    .requiredOption("-i, --input <text>", "comma-separated input texts")
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).models.small.embeddings(id, csv(opts.input) ?? []),
        outputOptions(cmd),
      );
    });
  small
    .command("rerank <modelId>")
    .description("Rerank documents against a query")
    .requiredOption("-q, --query <text>", "query")
    .requiredOption("-d, --documents <list>", "comma-separated documents")
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).models.small.rerank(id, opts.query, csv(opts.documents) ?? []),
        outputOptions(cmd),
      );
    });
  small
    .command("get-default")
    .description("Show the system default small model for a type")
    .option("--type <t>", "model type: embedding | reranker", "embedding")
    .action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).models.small.getDefault(opts.type), outputOptions(cmd));
    });
  small
    .command("set-default <modelId>")
    .description("Set this small model as the system default for its type (admin)")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).models.small.setDefault(id, true), outputOptions(cmd));
    });
  small
    .command("unset-default <modelId>")
    .description("Clear this small model as the system default (admin)")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).models.small.setDefault(id, false), outputOptions(cmd));
    });
  addManagementCommands(small, "small");

  model.addHelpText(
    "after",
    `
Identifiers:
  • get / set-default / delete take the numeric model id (e.g. 2071747547839467520).
  • chat takes a model NAME, but also accepts a numeric id (resolved to its name).

Examples:
  $ openbkn model llm list                          # ids + the 'default' flag
  $ openbkn model llm chat deepseek_v4_flash -m hi  # by name
  $ openbkn model llm chat 2071747547839467520 -m hi --stream   # by id, streamed
  $ openbkn model llm set-default 2071747547839467520           # system default LLM
  $ openbkn model small get-default --type embedding            # current default
  $ openbkn model small set-default <id>                        # default embedding/reranker`,
  );

  return group(model, "MODELS & SKILLS");
}
