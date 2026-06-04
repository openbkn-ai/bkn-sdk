/** `openbkn trace …` — trace data (search/get) + symbolic diagnose. */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { renderReportMarkdown } from "../trace-ai/diagnose.js";
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

  cmd
    .command("diagnose <conversation-id>")
    .description("Diagnose a conversation's trace (symbolic rules; --llm adds rubric judging)")
    .option("--llm", "also run LLM-judged rubric rules via the local `claude` CLI")
    .action(async (conversationId: string, opts, cmd: Command) => {
      const report = await clientFrom(cmd).trace.diagnose(conversationId, {
        llm: Boolean(opts.llm),
      });
      const out = outputOptions(cmd);
      if (out.json) printJson(report, out);
      else console.log(renderReportMarkdown(report));
    });

  // eval-set / schema are the LLM-as-judge pillar (eval-set builder/runner +
  // rubric judging via a local agent provider) — a separate large slice.
  for (const name of ["eval-set", "schema"]) {
    cmd
      .command(name)
      .description(`${name} (pending)`)
      .allowUnknownOption()
      .action(notImplemented(name));
  }

  return group(cmd, "TRACE AI");
}
