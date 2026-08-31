// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** `openbkn config …` — active platform configuration. */
import { Command } from "commander";
import { activePlatform, setActivePlatform } from "../config/store.js";
import { group, groupChildren } from "../help/grouped-help.js";
import { trimTrailingSlashes } from "../utils/base-url.js";
import { InputError } from "../utils/errors.js";
import { printJson } from "../utils/output.js";
import { outputOptions } from "./_shared.js";

export function configCommand(): Command {
  const config = new Command("config").description("Remember a platform URL");

  config
    .command("show")
    .description("Show the active platform")
    .action((_opts, cmd: Command) => {
      const baseUrl = activePlatform();
      printJson({ baseUrl }, outputOptions(cmd));
    });

  config
    .command("set <key> <value>")
    .description("Set a config value (baseUrl)")
    .action((key: string, value: string, _opts, cmd: Command) => {
      if (key === "baseUrl") {
        setActivePlatform(trimTrailingSlashes(value));
      } else {
        throw new InputError(`Unknown config key: ${key} (expected baseUrl)`);
      }
      printJson({ ok: true, key, value }, outputOptions(cmd));
    });

  groupChildren(config, { READ: ["show"], WRITE: ["set"] });

  return group(config, "SIGN IN & SETTINGS");
}
