/** `openbkn agent …` — decision agents (read side + listings). */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, csv, outputOptions, readBody } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

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

  cmd
    .command("create")
    .description("Create an agent (--body-file <json> or --body '<json>')")
    .option("--body <json>", "agent definition JSON")
    .option("--body-file <path>", "read agent definition JSON from a file")
    .action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.create(readBody(opts)), outputOptions(cmd));
    });

  cmd
    .command("update <id>")
    .description("Update an agent (--body-file <json> or --body '<json>')")
    .option("--body <json>", "agent definition JSON")
    .option("--body-file <path>", "read agent definition JSON from a file")
    .action(async (id: string, opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.update(id, readBody(opts)), outputOptions(cmd));
    });

  cmd
    .command("delete <id>")
    .description("Delete an agent")
    .option("-y, --yes", "skip confirmation")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.delete(id), outputOptions(cmd));
    });

  cmd
    .command("publish <id>")
    .description("Publish an agent")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.publish(id), outputOptions(cmd));
    });

  cmd
    .command("unpublish <id>")
    .description("Unpublish an agent")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.unpublish(id), outputOptions(cmd));
    });

  cmd
    .command("sessions <agent>")
    .description("List conversations for an agent (by agent key)")
    .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
    .option("--page <n>", "page", int, 1)
    .action(async (agentKey: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).agents.sessions(agentKey, { size: opts.limit, page: opts.page }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("history <agent> <conversation-id>")
    .description("Show message history for a conversation")
    .action(async (agentKey: string, conversationId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.history(agentKey, conversationId), outputOptions(cmd));
    });

  cmd
    .command("chat <agent-id>")
    .description("Chat with an agent (SSE streaming with --stream)")
    .requiredOption("-m, --message <text>", "user message")
    .option("--version <v>", "agent version", "v0")
    .option("--conversation-id <id>", "continue an existing conversation")
    .option("--stream", "stream the reply to stdout as it arrives")
    .action(async (agentId: string, opts, cmd: Command) => {
      const client = clientFrom(cmd);
      if (opts.stream) {
        const res = await client.agents.chat(agentId, opts.message, {
          version: opts.version,
          conversationId: opts.conversationId,
          stream: true,
          onDelta: (t) => process.stdout.write(t),
        });
        process.stdout.write("\n");
        if (res.conversationId) console.error(`conversation_id: ${res.conversationId}`);
        return;
      }
      printJson(
        await client.agents.chat(agentId, opts.message, {
          version: opts.version,
          conversationId: opts.conversationId,
        }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("trace <conversation-id>")
    .description("Get trace spans for a conversation (agent-scoped alias of `trace get`)")
    .action(async (conversationId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).trace.spans(conversationId), outputOptions(cmd));
    });

  const skill = cmd.command("skill").description("Manage skills attached to an agent");
  skill
    .command("list <agent-id>")
    .description("List skill ids attached to an agent")
    .action(async (agentId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.skillList(agentId), outputOptions(cmd));
    });
  skill
    .command("add <agent-id> <skill-ids>")
    .description("Attach skill(s) to an agent (comma-joined ids)")
    .action(async (agentId: string, ids: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).agents.skillAdd(agentId, csv(ids) ?? []), outputOptions(cmd));
    });
  skill
    .command("remove <agent-id> <skill-ids>")
    .description("Detach skill(s) from an agent (comma-joined ids)")
    .action(async (agentId: string, ids: string, _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).agents.skillRemove(agentId, csv(ids) ?? []),
        outputOptions(cmd),
      );
    });

  return group(cmd, "DECISION AGENT");
}
