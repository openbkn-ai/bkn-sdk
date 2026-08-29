// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Builds the `openbkn` command tree. Separate from the entry point so tests and
 * `describe` can hold the tree without parsing argv or exiting the process.
 */
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { adminCommand } from "./commands/admin.js";
import { appkeyCommand } from "./commands/appkey.js";
import { authCommand } from "./commands/auth.js";
import { bknCommand } from "./commands/bkn.js";
import { callCommand } from "./commands/call.js";
import { configCommand } from "./commands/config.js";
import { contextCommand } from "./commands/context.js";
import { describeCommand } from "./commands/describe.js";
import { functionCommand } from "./commands/function.js";
import { modelCommand } from "./commands/model.js";
import { operatorCommand } from "./commands/operator.js";
import { resourceCommand } from "./commands/resource.js";
import { skillCommand } from "./commands/skill.js";
import { toolCommand, toolboxCommand } from "./commands/toolbox.js";
import { traceCommand } from "./commands/trace.js";
import { vegaCommand } from "./commands/vega.js";
import { guide, installGroupedHelp } from "./help/grouped-help.js";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("openbkn")
    .description(
      "openbkn — one CLI for the BKN platform: knowledge networks, the data behind them,\n" +
        "the tools and skills agents run on them, and the traces they leave.",
    )
    .version(pkg.version, "-V, --version", "output the version number")
    .option("--base-url <url>", "platform base URL (env: BKN_BASE_URL)")
    .option("--token <value>", "access token (env: BKN_TOKEN)")
    .option("--user <id|name>", "use specific user credentials (env: BKN_USER)")
    .option("--json", "machine-readable JSON output")
    .option("--compact", "single-line JSON output")
    .option("--full", "human view: show all columns (default trims to the key ones)")
    .option("--biz-domain <s>", "business domain (alias: -bd)")
    .option("--conversation-id <id>", "BKN Trace conversation id (env: BKN_CONVERSATION_ID)")
    .option("--interaction-id <id>", "BKN Trace interaction id (env: BKN_INTERACTION_ID)")
    .option(
      "--new-conversation",
      "ignore the remembered conversation for this command (see `openbkn context conversation`)",
    )
    .option("-k, --insecure", "skip TLS verification (dev / self-signed only)")
    .option("--dry-run", "print the request this command would send, and send nothing")
    // The pointer that replaces the full-help dump is installed for every
    // command by `installGroupedHelp`, which knows each one's path.
    .showHelpAfterError();

  // Real commands. Registration order sets the order of help sections.
  program.addCommand(authCommand());
  program.addCommand(configCommand());
  program.addCommand(appkeyCommand());
  program.addCommand(bknCommand());
  program.addCommand(vegaCommand());
  program.addCommand(resourceCommand());
  program.addCommand(contextCommand());
  program.addCommand(modelCommand());
  program.addCommand(skillCommand());
  program.addCommand(toolboxCommand());
  program.addCommand(toolCommand());
  program.addCommand(functionCommand());
  program.addCommand(operatorCommand());
  program.addCommand(traceCommand());
  program.addCommand(adminCommand());
  program.addCommand(callCommand());
  program.addCommand(describeCommand(program));

  // Read after the command list, before FLAGS: how to start, what a typical job
  // looks like end to end, and which platform capabilities have no command yet.
  guide(
    program,
    `FIRST STEPS
    openbkn auth login https://your-platform -u <user> -p <pass>
    openbkn bkn list                       # knowledge networks you can see
    openbkn bkn --help                     # every group has its own help
    openbkn describe --depth 1             # the whole map as one table; \`describe <command>\`
                                           # drills in, --json ships the same tree as data

  COMMON TASKS
    Answer a question    bkn search <kn-id> "<q>"  ->  context search-schema  ->
                         context query-object-instance --args '<json>'
    Look at the data     vega catalog list  ->  resource find --name <t>  ->  resource query <id>
    Build from a catalog bkn create-from-catalog <catalog-id> --name "<n>"  ->
                         vega dataset build <resource-id>
    Edit as files        bkn pull <kn-id> ./kn  ->  bkn validate ./kn  ->  bkn push ./kn
    Ship a capability    skill register ./my-skill; toolbox create --name "<n>"  ->
                         tool upload ./api.yaml --toolbox <id>  ->  toolbox publish <id>
    Ship some code       function run ./add.py  ->  operator register ./add.py --name add
                         --publish  ->  operator convert-to-tool <id> --toolbox <box-id>
    Debug an answer      trace conversations list  ->  trace diagnose <conversation-id> --llm

  GOOD TO KNOW
    Every command group sorts its subcommands into the same four sections: GROUPS nests one
    level deeper, READ changes nothing, RUN acts without changing configuration (triggers a
    job, spends a model call, rotates a token), WRITE changes platform state — confirm those
    with a person first.
    Add --json to any command for machine-readable output (the default view trims columns,
    --full widens it). Most list commands answer {entries, total_count}; anything else says
    so in its own description. Ids come from list/search output — opaque, never guess one,
    and the key holding one is not always \`id\` (\`skill_id\`, \`conversation_id\`, \`ot_id\` …).
    Multi-tenant deploys: --biz-domain picks the domain, --user switches saved logins.
    \`openbkn call\` reaches any endpoint a command does not cover, auth injected. Look the
    path up at https://openbkn-ai.github.io/bkn-foundry/ first — do not guess one.`,
  );

  // Apply grouped help to the whole tree (after all commands are registered).
  installGroupedHelp(program);

  return program;
}
