/**
 * `openbkn admin …` — the kweaver-admin operator CLI, nested as a subcommand.
 * Mapping is 1:1: `kweaver-admin <x>` → `openbkn admin <x>`. Subcommands are
 * stubs until implemented (operator endpoints need a deployed env to test).
 */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";

function notImplemented(path: string): () => never {
  return () => {
    throw new Error(`\`openbkn admin ${path}\` is not implemented yet.`);
  };
}

function sub(parent: Command, name: string, subs: string[]): void {
  const cmd = parent.command(name).description(`${name} (pending)`);
  for (const s of subs) {
    cmd
      .command(s)
      .description(`${s} (pending)`)
      .allowUnknownOption()
      .action(notImplemented(`${name} ${s}`));
  }
  if (subs.length === 0) cmd.action(notImplemented(name));
}

/** The admin subtree, mirroring the kweaver-admin command set exactly. */
export function adminCommand(): Command {
  const admin = new Command("admin").description(
    "Operator CLI (kweaver-admin): org, user, role, models, audit",
  );

  sub(admin, "auth", ["login", "logout", "status", "whoami", "list", "change-password", "token"]);
  sub(admin, "org", ["list", "tree", "get", "create", "update", "delete", "members"]);
  sub(admin, "user", [
    "list",
    "get",
    "create",
    "update",
    "delete",
    "roles",
    "assign-role",
    "revoke-role",
    "reset-password",
  ]);
  sub(admin, "role", ["list", "get", "members", "add-member", "remove-member"]);
  sub(admin, "llm", ["list", "get", "add", "edit", "delete", "test"]);
  sub(admin, "small-model", ["list", "get", "add", "edit", "delete", "test"]);
  sub(admin, "audit", ["list"]);
  sub(admin, "config", ["show", "set"]);
  sub(admin, "call", []);

  return group(admin, "OPERATOR");
}
