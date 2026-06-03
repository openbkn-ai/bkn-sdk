/** `openbkn trace …` — trace data (search/get). Diagnose/eval-set pending. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions, readBody } from "./_shared.js";

function notImplemented(path: string): () => never {
  return () => {
    throw new Error(
      `\`openbkn trace ${path}\` is not implemented yet (rule engine + LLM-as-judge; see tech-debt).`,
    );
  };
}

export function traceCommand(): Command {
  const cmd = new Command("trace").description(
    "Trace AI — fetch trace spans; diagnose/eval-set (rule engine) pending",
  );

  cmd
    .command("get <conversation-id>")
    .description("Fetch all trace spans for a conversation")
    .option("--max-spans <n>", "max spans", (v) => Number.parseInt(v, 10))
    .action(async (conversationId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).trace.spans(conversationId, { maxSpans: opts.maxSpans }),
        outputOptions(cmd),
      );
    });

  cmd
    .command("search")
    .description("Raw trace search (--body / --body-file OpenSearch JSON)")
    .option("--body <json>", "search body JSON")
    .option("--body-file <path>", "read search body JSON from a file")
    .action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).trace.search(readBody(opts)), outputOptions(cmd));
    });

  // Diagnose / eval-set / schema are the LLM rule-engine feature (large,
  // depends on the local `claude` CLI) — tracked as a separate slice.
  for (const name of ["diagnose", "eval-set", "schema"]) {
    cmd
      .command(name)
      .description(`${name} (pending)`)
      .allowUnknownOption()
      .action(notImplemented(name));
  }

  return group(cmd, "TRACE AI");
}
