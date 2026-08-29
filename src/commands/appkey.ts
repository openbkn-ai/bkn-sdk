// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * `openbkn appkey …` — manage user-issued AppKeys (long-lived `bak_` credentials
 * for the Context Loader). Managing keys needs a real OAuth session (the normal
 * `--token` / `auth login`); an AppKey cannot mint AppKeys. To USE a key, pass it
 * as `--token bak_…` against `openbkn context …` — no extra setup.
 */
import { Command } from "commander";
import type { CreatedApiKey } from "../api/app-keys.js";
import { group, groupChildren } from "../help/grouped-help.js";
import { InputError } from "../utils/errors.js";
import { type OutputOptions, printJson } from "../utils/output.js";
import { clientFrom, outputOptions } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

const DAY_MS = 86_400_000;

/**
 * Print a freshly-minted key. With `--json`/`--compact` → the full object (for
 * scripts). Otherwise spotlight the one-time plaintext + essentials only; the
 * warning goes to stderr so `… > key.txt` still captures just the body.
 */
function printNewKey(created: CreatedApiKey, out: OutputOptions): void {
  if (out.json || out.compact) {
    printJson(created, out);
    return;
  }
  process.stderr.write(
    "⚠️  Copy this key now — the plaintext is shown only once and cannot be retrieved again.\n\n",
  );
  const fields: Array<[string, string]> = [
    ["key", created.key],
    ["name", created.name],
    ["id", `${created.id}  (use this to revoke/regenerate)`],
    ["key_id", created.key_id],
    ["expires_at", created.expires_at ?? "never"],
  ];
  const w = Math.max(...fields.map(([k]) => k.length));
  for (const [k, v] of fields) process.stdout.write(`  ${k.padEnd(w)}  ${v}\n`);
}

export function appkeyCommand(): Command {
  const appkey = new Command("appkey").description(
    "Issue long-lived `bak_` keys for scripts and services",
  );

  appkey
    .command("list")
    .description("List your own AppKeys, no secrets → {keys}")
    .action(async (_opts, cmd: Command) => {
      printJson(await clientFrom(cmd).appKeys.list(), outputOptions(cmd));
    });

  appkey
    .command("create")
    .description("Issue an AppKey — the plaintext key is shown ONCE, on create")
    .requiredOption("--name <s>", "display name (to tell keys apart)")
    .option("--expires-at <rfc3339>", "expiry as RFC3339 (e.g. 2027-01-01T00:00:00Z)")
    .option("--expire-days <n>", "expiry in N days from now (alternative to --expires-at)", int)
    .option("--never-expire", "never expire (wins over --expires-at/--expire-days)")
    .action(async (opts, cmd: Command) => {
      let expiresAt = opts.expiresAt as string | undefined;
      if (opts.expireDays !== undefined) {
        if (!Number.isFinite(opts.expireDays) || opts.expireDays <= 0) {
          throw new InputError("--expire-days must be a positive integer.");
        }
        if (expiresAt) {
          throw new InputError("Use either --expires-at or --expire-days, not both.");
        }
        expiresAt = new Date(Date.now() + opts.expireDays * DAY_MS).toISOString();
      }
      const created = await clientFrom(cmd).appKeys.create({
        name: opts.name,
        expiresAt,
        neverExpire: Boolean(opts.neverExpire),
      });
      printNewKey(created, outputOptions(cmd));
    });

  appkey
    .command("regenerate <id>")
    .alias("rotate")
    .description("Rotate a key in place — mints a new plaintext; the old bak_ dies immediately")
    .action(async (id: string, _opts, cmd: Command) => {
      const created = await clientFrom(cmd).appKeys.regenerate(id);
      printNewKey(created, outputOptions(cmd));
    });

  appkey
    .command("revoke <id>")
    .alias("delete")
    .alias("rm")
    .description("Revoke one of your AppKeys (immediate; use the `id`, not `key_id`)")
    .action(async (id: string, _opts, cmd: Command) => {
      await clientFrom(cmd).appKeys.revoke(id);
      printJson({ revoked: id }, outputOptions(cmd));
    });

  // ── admin (governance / incident response) ──
  const admin = appkey.command("admin").description("Admin governance over all AppKeys");
  admin
    .command("list")
    .description("List all AppKeys, or one owner's (adds owner_user_id)")
    .option("--owner-id <id>", "filter to a single owner")
    .action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).appKeys.adminList(opts.ownerId), outputOptions(cmd));
    });
  admin
    .command("revoke <id>")
    .alias("delete")
    .alias("rm")
    .description("Revoke any AppKey by id")
    .action(async (id: string, _opts, cmd: Command) => {
      await clientFrom(cmd).appKeys.adminRevoke(id);
      printJson({ revoked: id }, outputOptions(cmd));
    });

  groupChildren(appkey, {
    GROUPS: ["admin"],
    READ: ["list"],
    WRITE: ["create", "regenerate", "revoke"],
  });
  const appkeyAdmin = appkey.commands.find((c) => c.name() === "admin");
  if (appkeyAdmin) groupChildren(appkeyAdmin, { READ: ["list"], WRITE: ["revoke"] });

  return group(appkey, "SIGN IN & SETTINGS");
}
