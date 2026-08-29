#!/usr/bin/env node
// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * `openbkn` — unified CLI for the BKN platform.
 * Thin shell: parse argv → call a resource → print. No business logic here.
 */
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { releaseLifecycleSessions } from "./api/lifecycle.js";
import { adminCommand } from "./commands/admin.js";
import { appkeyCommand } from "./commands/appkey.js";
import { authCommand } from "./commands/auth.js";
import { bknCommand } from "./commands/bkn.js";
import { callCommand } from "./commands/call.js";
import { configCommand } from "./commands/config.js";
import { contextCommand } from "./commands/context.js";
import { exploreCommand } from "./commands/explore.js";
import { modelCommand } from "./commands/model.js";
import { resourceCommand } from "./commands/resource.js";
import { skillCommand } from "./commands/skill.js";
import { toolCommand, toolboxCommand } from "./commands/toolbox.js";
import { traceCommand } from "./commands/trace.js";
import { vegaCommand } from "./commands/vega.js";
import { guide, installGroupedHelp } from "./help/grouped-help.js";
import { formatError, toExitCode } from "./utils/errors.js";

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
program.addCommand(traceCommand());
program.addCommand(adminCommand());
program.addCommand(exploreCommand());
program.addCommand(callCommand());

// Read after the command list, before FLAGS: how to start, what a typical job
// looks like end to end, and which platform capabilities have no command yet.
guide(
  program,
  `FIRST STEPS
  openbkn auth login https://your-platform -u <user> -p <pass>
  openbkn bkn list                       # knowledge networks you can see
  openbkn bkn --help                     # every group has its own help

COMMON TASKS
  Answer a question    bkn search <kn-id> "<q>"  ->  context search-schema  ->
                       context query-object-instance --args '<json>'
  Look at the data     vega catalog list  ->  resource find --name <t>  ->  resource query <id>
  Build from a catalog bkn create-from-catalog <catalog-id> --name "<n>"  ->
                       vega dataset build <resource-id>
  Edit as files        bkn pull <kn-id> ./kn  ->  bkn validate ./kn  ->  bkn push ./kn
  Ship a capability    skill register ./my-skill; toolbox create --name "<n>"  ->
                       tool upload ./api.yaml --toolbox <id>  ->  toolbox publish <id>
  Debug an answer      trace conversations list  ->  trace diagnose <conversation-id> --llm

GOOD TO KNOW
  Add --json to any command for machine-readable output (the default view trims columns,
  --full widens it). Ids come from list/search output — they are opaque, never guess one.
  list/get/search only read; create, delete, publish and execute change the platform.
  Multi-tenant deploys: --biz-domain picks the domain, --user switches saved logins.
  \`openbkn call\` reaches any endpoint a command does not cover, auth injected. Look the
  path up at https://openbkn-ai.github.io/bkn-foundry/ first — do not guess one.`,
);

// Apply grouped help to the whole tree (after all commands are registered).
installGroupedHelp(program);

// Legacy `-bd` is a 2-char short flag commander can't declare; rewrite it to
// the canonical `--biz-domain` before parsing (legacy compatibility).
const argv = process.argv.map((a) => (a === "-bd" ? "--biz-domain" : a));

try {
  await program.parseAsync(argv);
} catch (err) {
  console.error(formatError(err));
  await releaseLifecycleSessions();
  process.exit(toExitCode(err));
}

// A deploy that manages lifecycle state opened an interaction for this command,
// and a conversation permits only one at a time. Hand it back on the way out
// instead of leaving it for the server's sweeper. Best-effort, never fatal.
await releaseLifecycleSessions();
