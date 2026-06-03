/**
 * `openbkn admin …` — the kweaver-admin operator CLI, nested as a subcommand.
 * Mapping is 1:1: `kweaver-admin <x>` → `openbkn admin <x>`. org/user/role
 * reads + writes (create/update/delete/reset-password) and org tree are real
 * and live-verified; operator `auth` reuses the top-level `openbkn auth`.
 */
import { Command } from "commander";
import { activePlatform, setActivePlatform } from "../config/store.js";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { renderOrgTree } from "../utils/org-tree.js";
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
  org
    .command("get <dept>")
    .description("Get one department")
    .action(async (deptId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.orgGet(deptId), outputOptions(cmd));
    });
  org
    .command("members <dept>")
    .description("List members of a department")
    .option("--role <r>", "role qualifier", "super_admin")
    .option("--limit <n>", "page size", int, 100)
    .action(async (deptId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.orgMembers(deptId, { role: opts.role, limit: opts.limit }),
        outputOptions(cmd),
      );
    });
  org
    .command("create <name>")
    .description("Create a department")
    .option("--parent <id>", "parent department id", "-1")
    .option("--code <s>", "department code")
    .option("--remark <s>", "remark")
    .option("--email <s>", "email")
    .option("--manager <id>", "manager user id")
    .action(async (name: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.orgCreate({
          name,
          parentId: opts.parent,
          code: opts.code,
          remark: opts.remark,
          email: opts.email,
          managerID: opts.manager,
        }),
        outputOptions(cmd),
      );
    });
  org
    .command("update <dept>")
    .description("Update a department (only provided fields change)")
    .option("--name <s>", "new name")
    .option("--code <s>", "department code")
    .option("--remark <s>", "remark")
    .option("--email <s>", "email")
    .option("--manager <id>", "manager user id")
    .option("--status <n>", "status (1=enabled)", int)
    .action(async (deptId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.orgUpdate(deptId, {
          name: opts.name,
          code: opts.code,
          remark: opts.remark,
          email: opts.email,
          managerID: opts.manager,
          status: opts.status,
        }),
        outputOptions(cmd),
      );
    });
  org
    .command("delete <dept>")
    .description("Delete a department")
    .action(async (deptId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.orgDelete(deptId), outputOptions(cmd));
    });
  org
    .command("tree")
    .description("Print the department hierarchy")
    .option("--role <r>", "role qualifier", "super_admin")
    .action(async (opts, cmd: Command) => {
      const tree = await clientFrom(cmd).admin.orgTree(opts.role);
      const out = outputOptions(cmd);
      if (out.json) printJson(tree, out);
      else console.log(renderOrgTree(tree));
    });

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
  user
    .command("get <user>")
    .description("Get one user")
    .action(async (userId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.userGet(userId), outputOptions(cmd));
    });
  user
    .command("roles <user>")
    .description("List roles granted to a user")
    .action(async (userId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.userRoles(userId), outputOptions(cmd));
    });
  user
    .command("create <login-name>")
    .description("Create a user (gets the platform default password)")
    .option("--display-name <s>", "display name (defaults to login name)")
    .option("--email <s>", "email")
    .option("--org <id>", "department id", "-1")
    .option("--code <s>", "user code")
    .option("--position <s>", "position")
    .option("--remark <s>", "remark")
    .option("--tel <s>", "telephone")
    .action(async (loginName: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.userCreate({
          loginName,
          displayName: opts.displayName,
          email: opts.email,
          departmentIds: opts.org ? [opts.org] : undefined,
          code: opts.code,
          position: opts.position,
          remark: opts.remark,
          telNumber: opts.tel,
        }),
        outputOptions(cmd),
      );
    });
  user
    .command("update <user>")
    .description("Update a user (only provided fields change)")
    .option("--display-name <s>", "display name")
    .option("--email <s>", "email")
    .option("--code <s>", "user code")
    .option("--position <s>", "position")
    .option("--remark <s>", "remark")
    .option("--tel <s>", "telephone")
    .option("--manager <id>", "manager user id")
    .action(async (userId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.userUpdate(userId, {
          displayName: opts.displayName,
          email: opts.email,
          code: opts.code,
          position: opts.position,
          remark: opts.remark,
          telNumber: opts.tel,
          managerID: opts.manager,
        }),
        outputOptions(cmd),
      );
    });
  user
    .command("delete <user>")
    .description("Delete a user")
    .action(async (userId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.userDelete(userId), outputOptions(cmd));
    });
  user
    .command("reset-password <user>")
    .description("Reset a user's password (RSA-encrypted in transit)")
    .requiredOption("--password <s>", "the new password")
    .action(async (userId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.userResetPassword(userId, opts.password),
        outputOptions(cmd),
      );
    });

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
  const adminConfig = admin.command("config").description("Admin CLI config (active platform)");
  adminConfig
    .command("show")
    .description("Show the active platform")
    .action((_opts, cmd: Command) => {
      printJson({ baseUrl: activePlatform() }, outputOptions(cmd));
    });
  adminConfig
    .command("set <key> <value>")
    .description("Set a config value (baseUrl)")
    .action((key: string, value: string, _opts, cmd: Command) => {
      if (key !== "baseUrl") {
        throw new Error(`Unknown config key: ${key} (only baseUrl supported)`);
      }
      setActivePlatform(value.replace(/\/+$/, ""));
      printJson({ ok: true, baseUrl: value }, outputOptions(cmd));
    });
  admin
    .command("call")
    .description("Admin API passthrough (pending)")
    .allowUnknownOption()
    .action(notImplemented("call"));

  return group(admin, "OPERATOR");
}
