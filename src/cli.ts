#!/usr/bin/env node
/**
 * `openbkn` — unified CLI for the BKN platform.
 * Thin shell: parse argv → call a resource → print. No business logic here.
 */
import { Command } from "commander";
import { adminCommand } from "./commands/admin.js";
import { authCommand } from "./commands/auth.js";
import { bknCommand } from "./commands/bkn.js";
import { callCommand } from "./commands/call.js";
import { configCommand } from "./commands/config.js";
import { resourceCommand } from "./commands/resource.js";
import { stubCommands } from "./commands/stubs.js";
import { vegaCommand } from "./commands/vega.js";
import { installGroupedHelp } from "./help/grouped-help.js";
import { formatError, toExitCode } from "./utils/errors.js";

const program = new Command();

program
  .name("openbkn")
  .description("Operate the BKN platform from the CLI")
  .version("0.1.0", "-V, --version", "output the version number")
  .option("--base-url <url>", "platform base URL (env: BKN_BASE_URL)")
  .option("--token <value>", "access token (env: BKN_TOKEN)")
  .option("--user <id|name>", "use specific user credentials (env: BKN_USER)")
  .option("--json", "machine-readable JSON output")
  .option("--compact", "single-line JSON output")
  .option("--biz-domain <s>", "business domain")
  .option("-k, --insecure", "skip TLS verification (dev / self-signed only)")
  .showHelpAfterError();

// Real commands.
program.addCommand(authCommand());
program.addCommand(callCommand());
program.addCommand(configCommand());
program.addCommand(vegaCommand());
program.addCommand(bknCommand());
program.addCommand(resourceCommand());
program.addCommand(adminCommand());

// Placeholders for the rest of the tree (filled in incrementally).
for (const cmd of stubCommands()) program.addCommand(cmd);

// Apply grouped help to the whole tree (after all commands are registered).
installGroupedHelp(program);

try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error(formatError(err));
  process.exit(toExitCode(err));
}
