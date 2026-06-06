/**
 * `openbkn admin …` — the kweaver-admin operator CLI, nested as a subcommand.
 * Mapping is 1:1: `kweaver-admin <x>` → `openbkn admin <x>`. org/user/role
 * reads + writes (create/update/delete/reset-password) and org tree are real
 * and live-verified; operator `auth` reuses the top-level `openbkn auth`.
 */
import { Command } from "commander";
import { rawCall } from "../api/call.js";
import { resolveContext } from "../config/resolve.js";
import { activePlatform, setActivePlatform } from "../config/store.js";
import { group } from "../help/grouped-help.js";
import { DEFAULT_LIST_LIMIT } from "../types.js";
import { renderOrgTree } from "../utils/org-tree.js";
import { printJson } from "../utils/output.js";
import { clientFrom, outputOptions, readBody } from "./_shared.js";
import { registerAuthLeaves } from "./auth.js";

const int = (v: string) => Number.parseInt(v, 10);

export function adminCommand(): Command {
  const admin = new Command("admin").description(
    "Operator CLI (kweaver-admin): org, user, role, models, audit",
  );

  // Operator auth = the same leaves as top-level `openbkn auth` (1:1 nest).
  registerAuthLeaves(admin.command("auth").description("Operator authentication"));

  const org = admin.command("org").description("Departments and org structure");
  org
    .command("list")
    .description("List departments")
    .option("--role <r>", "role qualifier", "super_admin")
    .option("--name <s>", "filter by name")
    .option("--limit <n>", "page size", int, 100)
    .option("--offset <n>", "page offset", int, 0)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.orgList({
          role: opts.role,
          name: opts.name,
          limit: opts.limit,
          offset: opts.offset,
        }),
        outputOptions(cmd),
      );
    });
  org
    .command("get <id>")
    .description("Get one department")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.orgGet(id), outputOptions(cmd));
    });
  org
    .command("members <id>")
    .description("List members of a department")
    .option("--role <r>", "role qualifier", "super_admin")
    .option("--fields <s>", "fields segment", "users")
    .option("--limit <n>", "page size", int, 100)
    .option("--offset <n>", "page offset", int, 0)
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.orgMembers(id, {
          role: opts.role,
          limit: opts.limit,
          offset: opts.offset,
        }),
        outputOptions(cmd),
      );
    });
  org
    .command("create")
    .description("Create a department")
    .requiredOption("--name <s>", "department name")
    .option("--parent <id>", "parent department id", "-1")
    .option("--code <s>", "department code")
    .option("--remark <s>", "remark")
    .option("--email <s>", "email")
    .option("--manager <id>", "manager user id")
    .option("--status <n>", "status (1=enabled)", int)
    .option("--oss-id <id>", "object-storage site id")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.orgCreate({
          name: opts.name,
          parentId: opts.parent,
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
    .command("update <id>")
    .description("Update a department (only provided fields change)")
    .option("--name <s>", "new name")
    .option("--code <s>", "department code")
    .option("--remark <s>", "remark")
    .option("--email <s>", "email")
    .option("--manager <id>", "manager user id")
    .option("--status <n>", "status (1=enabled)", int)
    .option("--oss-id <id>", "object-storage site id")
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.orgUpdate(id, {
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
    .command("delete <id>")
    .description("Delete a department")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.orgDelete(id), outputOptions(cmd));
    });
  org
    .command("tree")
    .description("Print the department hierarchy")
    .option("--role <r>", "role qualifier", "super_admin")
    .action(async (opts, cmd: Command) => {
      const tree = await clientFrom(cmd).admin.orgTree(opts.role);
      const out = outputOptions(cmd);
      if (out.json) printJson(tree, out);
      else console.log(renderOrgTree(tree as Parameters<typeof renderOrgTree>[0]));
    });

  const user = admin.command("user").description("User management");
  user
    .command("list")
    .description("List users")
    .option("--org <id>", "filter by department id")
    .option("--keyword <s>", "filter by name")
    .option("--limit <n>", "page size", int, 100)
    .option("--offset <n>", "page offset", int, 0)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.userList({
          orgId: opts.org,
          name: opts.keyword,
          limit: opts.limit,
          offset: opts.offset,
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
    .command("get <id>")
    .description("Get one user")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.userGet(id), outputOptions(cmd));
    });
  user
    .command("roles <user>")
    .description("List roles granted to a user")
    .action(async (userId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.userRoles(userId), outputOptions(cmd));
    });
  user
    .command("create")
    .description("Create a user (gets the platform default password)")
    .requiredOption("--login <name>", "login name")
    .option("--display-name <s>", "display name (defaults to login name)")
    .option("--email <s>", "email")
    .option("--department <id>", "department id", "-1")
    .option("--code <s>", "user code")
    .option("--position <s>", "position")
    .option("--remark <s>", "remark")
    .option("--tel <s>", "telephone")
    .option("--priority <n>", "priority", int)
    .option("--csf-level <n>", "confidentiality level", int)
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.userCreate({
          loginName: opts.login,
          displayName: opts.displayName,
          email: opts.email,
          departmentIds: opts.department ? [opts.department] : undefined,
          code: opts.code,
          position: opts.position,
          remark: opts.remark,
          telNumber: opts.tel,
          priority: opts.priority,
          csfLevel: opts.csfLevel,
        }),
        outputOptions(cmd),
      );
    });
  user
    .command("update <id>")
    .description("Update a user (only provided fields change)")
    .option("--display-name <s>", "display name")
    .option("--email <s>", "email")
    .option("--code <s>", "user code")
    .option("--position <s>", "position")
    .option("--remark <s>", "remark")
    .option("--tel <s>", "telephone")
    .option("--manager <id>", "manager user id")
    .option("--idcard <s>", "id-card number")
    .option("--priority <n>", "priority", int)
    .option("--csf-level <n>", "confidentiality level", int)
    .option("--csf-level2 <n>", "secondary confidentiality level", int)
    .option("--expire-time <n>", "account expiry (epoch, -1 = never)", int)
    .action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.userUpdate(id, {
          displayName: opts.displayName,
          email: opts.email,
          code: opts.code,
          position: opts.position,
          remark: opts.remark,
          telNumber: opts.tel,
          managerID: opts.manager,
          priority: opts.priority,
          csfLevel: opts.csfLevel,
        }),
        outputOptions(cmd),
      );
    });
  user
    .command("delete <id>")
    .description("Delete a user")
    .action(async (id: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.userDelete(id), outputOptions(cmd));
    });
  user
    .command("reset-password [id]")
    .description("Reset a user's password (RSA-encrypted in transit)")
    .option("--id <userId>", "explicit user UUID (alt to the positional id)")
    .option("--user <account>", "resolve the user by account / login name")
    .option("--password <s>", "the new password")
    .option("--new-password <s>", "the new password (alias of --password)")
    .option("--prompt-password", "prompt for the new password interactively")
    .option("-y, --yes", "skip confirmation")
    .action(async (id: string | undefined, opts, cmd: Command) => {
      const userId = id ?? opts.id ?? opts.user;
      const pwd = opts.password ?? opts.newPassword;
      if (!userId) throw new Error("Provide a user id (positional or --id).");
      if (!pwd) throw new Error("Provide --password / --new-password.");
      printJson(await clientFrom(cmd).admin.userResetPassword(userId, pwd), outputOptions(cmd));
    });

  const role = admin.command("role").description("Role management");
  role
    .command("list")
    .description("List roles")
    .option("--keyword <s>", "filter by keyword")
    .option("--limit <n>", "page size", int, 100)
    .option("--offset <n>", "page offset", int, 0)
    .option("--source <s>", "role source filter (business | user)")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.roleList({ keyword: opts.keyword, limit: opts.limit }),
        outputOptions(cmd),
      );
    });
  role
    .command("get <role>")
    .description("Get a role by id")
    .option("--view <mode>", "detail view mode")
    .action(async (roleId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.roleGet(roleId), outputOptions(cmd));
    });
  role
    .command("members <role>")
    .description("List members of a role")
    .option("--keyword <s>", "filter by keyword")
    .option("--type <t>", "filter by member type (user|department|group|app)")
    .option("--member <spec...>", "filter to specific member(s) '<type>:<id-or-name>'")
    .option("--limit <n>", "page size", int, 100)
    .option("--offset <n>", "page offset", int, 0)
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
    .description("Add a member to a role")
    .option("--type <t>", "member type", "user")
    .option("--member <spec...>", "member(s) as '<type>:<id-or-name>' (alt to <id>)")
    .action(async (roleId: string, id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.addRoleMember(roleId, id, opts.type),
        outputOptions(cmd),
      );
    });
  role
    .command("remove-member <role> <id>")
    .description("Remove a member from a role")
    .option("--type <t>", "member type", "user")
    .option("--member <spec...>", "member(s) as '<type>:<id-or-name>' (alt to <id>)")
    .action(async (roleId: string, id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.removeRoleMember(roleId, id, opts.type),
        outputOptions(cmd),
      );
    });
  role
    .command("create")
    .description("Create a custom role (bkn-safe; built-in roles are read-only)")
    .requiredOption("--name <name>", "role name")
    .option("--description <text>", "role description")
    .action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.roleCreate(opts.name, opts.description),
        outputOptions(cmd),
      );
    });
  role
    .command("update <role>")
    .description("Update a custom role's name/description (403 on built-in)")
    .option("--name <name>", "new name")
    .option("--description <text>", "new description")
    .action(async (roleId: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).admin.roleUpdate(roleId, {
          name: opts.name,
          description: opts.description,
        }),
        outputOptions(cmd),
      );
    });
  role
    .command("delete <role>")
    .description("Delete a custom role (403 on built-in)")
    .option("-y, --yes", "skip confirmation")
    .action(async (roleId: string, _opts, cmd: Command) => {
      printJson(await clientFrom(cmd).admin.roleDelete(roleId), outputOptions(cmd));
    });

  // Models management reuses the (validated) mf-model-manager client. Granular
  // flags assemble the request body; `--body`/`--body-file` override wins.
  const modelBody = (opts: Record<string, unknown>): unknown => {
    if (opts.body || opts.bodyFile) return readBody(opts as { body?: string; bodyFile?: string });
    const mc: Record<string, unknown> = {};
    if (opts.apiModel) mc.api_model = opts.apiModel;
    if (opts.apiUrl) mc.api_url = opts.apiUrl;
    if (opts.apiBase) mc.api_url = opts.apiBase;
    if (opts.apiKey) mc.api_key = opts.apiKey;
    const body: Record<string, unknown> = {};
    if (opts.name) body.model_name = opts.name;
    if (opts.series) body.model_series = opts.series;
    if (opts.type) body.model_type = opts.type;
    if (opts.icon) body.icon = opts.icon;
    if (opts.embeddingDim !== undefined) body.model_dimensions = opts.embeddingDim;
    if (opts.maxTokens !== undefined) body.max_model_len = opts.maxTokens;
    if (opts.batchSize !== undefined) body.batch_size = opts.batchSize;
    if (Object.keys(mc).length > 0) body.model_config = mc;
    return body;
  };
  for (const kind of ["llm", "small-model"] as const) {
    const isLlm = kind === "llm";
    const m = admin.command(kind).description(`${kind} management`);
    const ns = isLlm ? "llm" : "small";

    const list = m
      .command("list")
      .description(`List ${kind} models`)
      .option("--name <s>", "filter by name")
      .option("--page <n>", "page", int, 1)
      .option("--size <n>", "page size", int, DEFAULT_LIST_LIMIT);
    (isLlm
      ? list.option("--series <s>", "model series")
      : list.option("--type <t>", "model type")
    ).action(async (opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).models[ns].list({
          name: opts.name,
          page: opts.page,
          limit: opts.size,
          modelType: opts.type,
        }),
        outputOptions(cmd),
      );
    });

    m.command("get <modelid>")
      .description(`Get a ${kind} model`)
      .action(async (id: string, _opts, cmd: Command) => {
        printJson(await clientFrom(cmd).models[ns].get(id), outputOptions(cmd));
      });

    const add = m
      .command("add")
      .description(`Register a ${kind} model (granular flags or --body/--body-file)`)
      .option("--name <s>", "model name")
      .option("--api-model <s>", "upstream API model id")
      .option("--api-key <s>", "upstream API key")
      .option("--body <json>", "model config JSON (overrides flags)")
      .option("--body-file <path>", "read config JSON from a file");
    if (isLlm) {
      add
        .option("--series <s>", "model series")
        .option("--api-base <url>", "upstream API base URL")
        .option("--icon <url>", "icon URL");
    } else {
      add
        .option("--type <t>", "small-model type (embedding|reranker)")
        .option("--api-url <url>", "upstream API URL")
        .option("--embedding-dim <n>", "embedding dimensions", int)
        .option("--max-tokens <n>", "max tokens", int)
        .option("--batch-size <n>", "batch size", int);
    }
    add.action(async (opts, cmd: Command) => {
      printJson(await clientFrom(cmd).models[ns].add(modelBody(opts)), outputOptions(cmd));
    });

    const edit = m
      .command("edit <modelid>")
      .description(`Edit a ${kind} model (granular flags or --body/--body-file)`)
      .option("--name <s>", "model name")
      .option("--body <json>", "model config JSON (overrides flags)")
      .option("--body-file <path>", "read config JSON from a file");
    if (isLlm) {
      edit.option("--icon <url>", "icon URL");
    } else {
      edit
        .option("--api-model <s>", "upstream API model id")
        .option("--api-url <url>", "upstream API URL");
    }
    edit.action(async (id: string, opts, cmd: Command) => {
      printJson(
        await clientFrom(cmd).models[ns].edit({ model_id: id, ...(modelBody(opts) as object) }),
        outputOptions(cmd),
      );
    });

    m.command("delete <modelid...>")
      .description(`Delete ${kind} model(s)`)
      .action(async (ids: string[], _opts, cmd: Command) => {
        printJson(await clientFrom(cmd).models[ns].delete(ids), outputOptions(cmd));
      });

    m.command("test <modelid>")
      .description(`Test a ${kind} model`)
      .option("--body <json>", "test request JSON")
      .option("--body-file <path>", "read test request JSON from a file")
      .action(async (id: string, opts, cmd: Command) => {
        const body = opts.body || opts.bodyFile ? (readBody(opts) as object) : {};
        printJson(
          await clientFrom(cmd).models[ns].test({ model_id: id, ...body }),
          outputOptions(cmd),
        );
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
    .command("call <url>")
    .description("Operator API passthrough (curl-style; auto-injected auth)")
    .option("-X, --request <method>", "HTTP method")
    .option(
      "-H, --header <header>",
      'extra header "Name: value" (repeatable)',
      (v, a: string[]) => {
        a.push(v);
        return a;
      },
      [] as string[],
    )
    .option("-d, --data <body>", "request body (JSON content-type if unset)")
    .action(async (url: string, opts, cmd: Command) => {
      const g = cmd.optsWithGlobals();
      const res = await rawCall(
        resolveContext({
          baseUrl: g.baseUrl,
          token: g.token,
          user: g.user,
          businessDomain: g.bizDomain,
          insecure: g.insecure,
        }),
        url,
        { method: opts.request, header: opts.header, data: opts.data, businessDomain: g.bizDomain },
      );
      const out = outputOptions(cmd);
      try {
        printJson(JSON.parse(res.body), out);
      } catch {
        process.stdout.write(res.body.endsWith("\n") ? res.body : `${res.body}\n`);
      }
      if (res.status >= 400) process.exitCode = 1;
    });

  return group(admin, "OPERATOR");
}
