/**
 * `openbkn admin …` — the kweaver-admin operator CLI, nested as a subcommand.
 * Mapping is 1:1: `kweaver-admin <x>` → `openbkn admin <x>`. List reads are
 * real (validated only with mocked fetch — operator endpoints need an admin
 * env); mutations remain stubs.
 */
import { Command } from "commander";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions, readBody } from "./_shared.js";

const int = (v: string) => Number.parseInt(v, 10);

function notImplemented(path: string): () => never {
  return () => {
    throw new Error(`\`openbkn admin ${path}\` is not implemented yet.`);
  };
}

/** Attach stub leaves to a command. */
function stubs(cmd: Command, groupName: string, names: string[]): void {
  for (const s of names) {
    cmd
      .command(s)
      .description(`${s} (pending)`)
      .allowUnknownOption()
      .action(notImplemented(`${groupName} ${s}`));
  }
}

export function adminCommand(): Command {
  const admin = new Command("admin").description(
    "Operator CLI (kweaver-admin): org, user, role, models, audit",
  );

  // auth (operator login) — stubbed; reuse top-level `openbkn auth` for now.
  stubs(admin.command("auth").description("Operator authentication"), "auth", [
    "login",
    "logout",
    "status",
    "whoami",
    "list",
    "change-password",
    "token",
  ]);

  const org = admin.command("org").description("Departments and org structure");
  org
    .command("list")
    .description("List departments")
    .option("--role <r>", "role qualifier", "super_admin")
    .option("--name <s>", "filter by name")
    .option("--limit <n>", "page size", int, 100)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.orgList({
          role: opts.role,
          name: opts.name,
          limit: opts.limit,
        }),
        outputOptions(cmd),
      );
    });
  stubs(org, "org", ["tree", "get", "create", "update", "delete", "members"]);

  const user = admin.command("user").description("User management");
  user
    .command("list")
    .description("List users")
    .option("--org <id>", "filter by department id")
    .option("--keyword <s>", "filter by name")
    .option("--limit <n>", "page size", int, 100)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.userList({
          orgId: opts.org,
          name: opts.keyword,
          limit: opts.limit,
        }),
        outputOptions(cmd),
      );
    });
  user
    .command("assign-role <user> <role>")
    .description("Grant a role to a user")
    .action(async (userId: string, roleId: string, _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.addRoleMember(roleId, userId, "user"),
        outputOptions(cmd),
      );
    });
  user
    .command("revoke-role <user> <role>")
    .description("Revoke a role from a user")
    .action(async (userId: string, roleId: string, _opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.removeRoleMember(roleId, userId, "user"),
        outputOptions(cmd),
      );
    });
  stubs(user, "user", ["get", "create", "update", "delete", "roles", "reset-password"]);

  const role = admin.command("role").description("Role management");
  role
    .command("list")
    .description("List roles")
    .option("--keyword <s>", "filter by keyword")
    .option("--limit <n>", "page size", int, 100)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.roleList({ keyword: opts.keyword, limit: opts.limit }),
        outputOptions(cmd),
      );
    });
  role
    .command("get <role>")
    .description("Get a role by id")
    .action(async (roleId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.roleGet(roleId), outputOptions(cmd));
    });
  role
    .command("members <role>")
    .description("List members of a role")
    .option("--keyword <s>", "filter by keyword")
    .option("--limit <n>", "page size", int, 100)
    .action(async (roleId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.roleMembers(roleId, {
          keyword: opts.keyword,
          limit: opts.limit,
        }),
        outputOptions(cmd),
      );
    });
  role
    .command("add-member <role> <id>")
    .description("Add a member to a role (--type user|department|group|app)")
    .option("--type <t>", "member type", "user")
    .action(async (roleId: string, id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.addRoleMember(roleId, id, opts.type),
        outputOptions(cmd),
      );
    });
  role
    .command("remove-member <role> <id>")
    .description("Remove a member from a role (--type user|department|group|app)")
    .option("--type <t>", "member type", "user")
    .action(async (roleId: string, id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.removeRoleMember(roleId, id, opts.type),
        outputOptions(cmd),
      );
    });

  // Models management reuses the (validated) mf-model-manager client.
  for (const kind of ["llm", "small-model"] as const) {
    const m = admin.command(kind).description(`${kind} management`);
    const ns = kind === "llm" ? "llm" : "small";
    m.command("list")
      .description(`List ${kind} models`)
      .option("--name <s>", "filter by name")
      .option("--limit <n>", "page size", int, DEFAULT_LIST_LIMIT)
      .action(async (opts, cmd: Command) => {
        printJson(
          await clientFrom(cmd).models[ns].list({ name: opts.name, limit: opts.limit }),
          outputOptions(cmd),
        );
      });
    m.command("get <modelId>")
      .description(`Get a ${kind} model`)
      .action(async (id: string, _opts, cmd: Command) => {
        printJson(await clientFrom(cmd).models[ns].get(id), outputOptions(cmd));
      });
    m.command("add")
      .description(`Register a ${kind} model (--body / --body-file)`)
      .option("--body <json>", "model config JSON")
      .option("--body-file <path>", "read config JSON from a file")
      .action(async (opts, cmd: Command) => {
        printJson(await clientFrom(cmd).models[ns].add(readBody(opts)), outputOptions(cmd));
      });
    m.command("edit")
      .description(`Edit a ${kind} model (--body / --body-file)`)
      .option("--body <json>", "model config JSON")
      .option("--body-file <path>", "read config JSON from a file")
      .action(async (opts, cmd: Command) => {
        printJson(await clientFrom(cmd).models[ns].edit(readBody(opts)), outputOptions(cmd));
      });
    m.command("delete <modelIds...>")
      .description(`Delete ${kind} model(s)`)
      .action(async (ids: string[], _opts, cmd: Command) => {
        printJson(await clientFrom(cmd).models[ns].delete(ids), outputOptions(cmd));
      });
    m.command("test")
      .description(`Test a ${kind} model (--body / --body-file)`)
      .option("--body <json>", "model config JSON")
      .option("--body-file <path>", "read config JSON from a file")
      .action(async (opts, cmd: Command) => {
        printJson(await clientFrom(cmd).models[ns].test(readBody(opts)), outputOptions(cmd));
      });
  }

  admin
    .command("audit")
    .description("Audit log queries")
    .command("list")
    .description("List login audit events")
    .option("--user <name>", "filter by user")
    .option("--start <time>", "start time")
    .option("--end <time>", "end time")
    .option("--page <n>", "page", int, 1)
    .option("--size <n>", "page size", int, 30)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.auditList({
          user: opts.user,
          start: opts.start,
          end: opts.end,
          page: opts.page,
          size: opts.size,
        }),
        outputOptions(cmd),
      );
    });
  stubs(admin.command("config").description("Admin config"), "config", ["show", "set"]);
  admin
    .command("call")
    .description("Admin API passthrough (pending)")
    .allowUnknownOption()
    .action(notImplemented("call"));

  return group(admin, "OPERATOR");
}
