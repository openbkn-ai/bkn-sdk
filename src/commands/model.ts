/** `openbkn model …` — model factory (llm / small-model). */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, csv, outputOptions, readBody } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

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
  const model = new Command("model").description("Model factory — LLM / small-model CRUD + chat");

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
    .command("chat <modelId>")
    .description("OpenAI-compatible chat completion")
    .requiredOption("-m, --message <text>", "user message")
    .option("--stream", "stream the reply token-by-token to stdout")
    .action(async (id: string, opts, cmd: Command) => {
      const messages = [{ role: "user", content: opts.message }];
      if (opts.stream) {
        await clientFrom(cmd).models.llm.chatStream(id, messages, (t) => process.stdout.write(t));
        process.stdout.write("\n");
        return;
      }
      printJson(await clientFrom(cmd).models.llm.chat(id, messages), outputOptions(cmd));
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
  addManagementCommands(small, "small");

  return group(model, "MODELS & SKILLS");
}
