import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { adminCommand } from "../../src/commands/admin.js";
import { writeVersionCheckCache } from "../../src/config/store.js";

const BASE = "https://demo.example.com";

function cli(): Command {
  const root = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <t>")
    .option("--json");
  root.addCommand(adminCommand());
  return root;
}

function mockFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function run(args: string[]): Promise<Command> {
  return cli().parseAsync(["--base-url", BASE, "--token", "t", "admin", ...args], {
    from: "user",
  });
}

const urlOf = (fetchMock: ReturnType<typeof vi.fn>, index = 0) =>
  new URL(fetchMock.mock.calls[index]?.[0] as string);

beforeEach(() => {
  writeVersionCheckCache(BASE, { serverVersion: pkg.version, checkedAt: new Date().toISOString() });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin audit", () => {
  const page = { data: [], next_cursor: null, partial: false };

  it("list maps every flag onto the observability logs query", async () => {
    const fetchMock = mockFetch(page);
    await run([
      "audit",
      "list",
      "--category",
      "audit.security",
      "--q",
      "grant",
      "--actor-id",
      "u-1",
      "--actor",
      "alice",
      "--request-id",
      "req-1",
      "--action",
      "create",
      "--target-type",
      "user",
      "--target-id",
      "t-1",
      "--outcome",
      "denied,failure",
      "--from",
      "2026-09-01T00:00:00Z",
      "--to",
      "2026-09-02T00:00:00Z",
      "--page",
      "2",
      "--limit",
      "100",
    ]);
    const url = urlOf(fetchMock);
    expect(url.pathname).toBe("/api/observability/v1/logs");
    expect(url.searchParams.getAll("categories")).toEqual(["audit.security"]);
    expect(url.searchParams.getAll("outcomes")).toEqual(["denied", "failure"]);
    url.searchParams.delete("categories");
    url.searchParams.delete("outcomes");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "grant",
      actor_id: "u-1",
      actor: "alice",
      request_id: "req-1",
      action: "create",
      target_type: "user",
      target_id: "t-1",
      time_from: "2026-09-01T00:00:00Z",
      time_to: "2026-09-02T00:00:00Z",
      page: "2",
      limit: "100",
    });
  });

  it("list defaults to both audit categories, the CLI limit, and accepts --start/--end", async () => {
    const fetchMock = mockFetch(page);
    await run([
      "audit",
      "list",
      "--start",
      "2026-09-01T00:00:00Z",
      "--end",
      "2026-09-02T00:00:00Z",
    ]);
    const url = urlOf(fetchMock);
    expect(url.searchParams.getAll("categories")).toEqual(["audit.admin", "audit.security"]);
    expect(url.searchParams.get("time_from")).toBe("2026-09-01T00:00:00Z");
    expect(url.searchParams.get("time_to")).toBe("2026-09-02T00:00:00Z");
    expect(url.searchParams.get("limit")).toBe("30");
  });

  it("--failed-only becomes outcomes=failure,denied (the server rejects failed_only)", async () => {
    const fetchMock = mockFetch(page);
    await run(["audit", "list", "--failed-only"]);
    const url = urlOf(fetchMock);
    expect(url.searchParams.getAll("outcomes")).toEqual(["failure", "denied"]);
    expect(url.searchParams.has("failed_only")).toBe(false);
    await expect(run(["audit", "list", "--failed-only", "--outcome", "success"])).rejects.toThrow(
      /pass one/,
    );
  });

  it("list refuses --limit outside 20..200 without sending", async () => {
    const fetchMock = mockFetch(page);
    await expect(run(["audit", "list", "--limit", "201"])).rejects.toThrow(/between 20 and 200/);
    await expect(run(["audit", "list", "--limit", "10"])).rejects.toThrow(/between 20 and 200/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("list drops the retired --resource/--before-id/--offset flags", () => {
    const list = adminCommand()
      .commands.find((c) => c.name() === "audit")
      ?.commands.find((c) => c.name() === "list");
    const visible = list?.options.filter((o) => !o.hidden).map((o) => o.long) ?? [];
    for (const gone of ["--resource", "--before-id", "--offset"]) {
      expect(visible).not.toContain(gone);
    }
    expect(visible).toEqual(expect.arrayContaining(["--target-type", "--page", "--cursor"]));
    expect(list?.description()).toMatch(/audit records/);
  });

  it("get reads one record by event id from the logs API", async () => {
    const fetchMock = mockFetch({ data: { event_id: "a-1", log_category: "audit.admin" } });
    await run(["audit", "get", "a-1"]);
    expect(urlOf(fetchMock).pathname).toBe("/api/observability/v1/logs/a-1");
  });

  it("never calls the retired /api/safe/v1/admin/audit-logs reader", async () => {
    const list = mockFetch(page);
    await run(["audit", "list"]);
    const get = mockFetch({ data: { event_id: "a-1", log_category: "audit.admin" } });
    await run(["audit", "get", "a-1"]);
    for (const fn of [list, get]) {
      expect(String(fn.mock.calls[0]?.[0])).not.toContain("/api/safe/v1/admin/audit-logs");
    }
  });
});

describe("admin role list", () => {
  const roles = {
    roles: [
      { id: "super_admin", name: "Super Admin", source: "business" },
      { id: "data_admin", name: "Data Admin", source: "business" },
      { id: "custom-1", name: "Analyst", source: "user" },
    ],
  };
  const printed = () =>
    JSON.parse(
      vi
        .mocked(process.stdout.write)
        .mock.calls.map((c) => String(c[0]))
        .join(""),
    ) as { roles: Array<{ id: string }>; total: number };

  it("pages with --offset and --limit and reports the total before paging", async () => {
    mockFetch(roles);
    await run(["role", "list", "--json", "--offset", "1", "--limit", "1"]);
    expect(printed()).toEqual({ roles: [roles.roles[1]], total: 3 });
  });

  it("filters by --keyword on id or name, case-insensitively", async () => {
    mockFetch(roles);
    await run(["role", "list", "--json", "--keyword", "ADMIN", "--limit", "1"]);
    expect(printed()).toEqual({ roles: [roles.roles[0]], total: 2 });
  });

  it("sends --source to the server", async () => {
    const fetchMock = mockFetch(roles);
    await run(["role", "list", "--source", "user"]);
    expect(urlOf(fetchMock).searchParams.get("source")).toBe("user");
  });
});

describe("admin llm list", () => {
  it("has no --series flag, which the server never filtered on", () => {
    const list = adminCommand()
      .commands.find((c) => c.name() === "llm")
      ?.commands.find((c) => c.name() === "list");
    expect(list?.options.map((o) => o.long)).not.toContain("--series");
  });
});

function mockFetchByPath(
  route: (url: URL, init: RequestInit) => unknown,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const body = route(new URL(input), init);
    return new Response(JSON.stringify(body ?? {}), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const bodyAt = (fetchMock: ReturnType<typeof vi.fn>, index = 0) =>
  JSON.parse(String((fetchMock.mock.calls[index]?.[1] as RequestInit).body));

const optionsOf = (path: string[]) => {
  let cmd = adminCommand();
  for (const name of path) {
    const next = cmd.commands.find((c) => c.name() === name);
    if (!next) throw new Error(`no command ${name}`);
    cmd = next;
  }
  return cmd.options.map((o) => o.long);
};

describe("admin org", () => {
  it("no longer offers the role/fields qualifiers bkn-safe never took", () => {
    expect(optionsOf(["org", "list"])).not.toContain("--role");
    expect(optionsOf(["org", "tree"])).not.toContain("--role");
    expect(optionsOf(["org", "members"])).not.toContain("--role");
    expect(optionsOf(["org", "members"])).not.toContain("--fields");
    expect(optionsOf(["org", "create"])).not.toContain("--status");
    expect(optionsOf(["org", "update"])).not.toContain("--oss-id");
  });

  it("members pages the member list with --offset/--limit and keeps the full total", async () => {
    mockFetch({ users: [{ id: "a" }, { id: "b" }, { id: "c" }], total: 3 });
    const stdout = vi.mocked(process.stdout.write);
    await run(["--json", "org", "members", "d1", "--offset", "1", "--limit", "1"]);
    const printed = stdout.mock.calls.map(([c]) => String(c)).join("");
    expect(JSON.parse(printed)).toEqual({ users: [{ id: "b" }], total: 3 });
  });

  it("create sends manager, code, remark and email, and no legacy '-1' parent", async () => {
    const fetchMock = mockFetch({ id: "d2" });
    await run([
      "org",
      "create",
      "--name",
      "Eng",
      "--manager",
      "u-1",
      "--code",
      "ENG",
      "--remark",
      "r",
      "--email",
      "eng@example.com",
    ]);
    expect(urlOf(fetchMock).pathname).toBe("/api/safe/v1/admin/departments");
    expect(bodyAt(fetchMock)).toEqual({
      name: "Eng",
      manager_id: "u-1",
      code: "ENG",
      remark: "r",
      email: "eng@example.com",
    });
  });

  it("update sends only the provided fields", async () => {
    const fetchMock = mockFetch({});
    await run(["org", "update", "d1", "--manager", "u-2", "--code", "X"]);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(bodyAt(fetchMock)).toEqual({ manager_id: "u-2", code: "X" });
  });

  it("tree reads every department page, not just the first 1000", async () => {
    const fetchMock = mockFetchByPath((url) => {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      if (offset === 0) {
        return {
          departments: Array.from({ length: 1000 }, (_, i) => ({ id: `d${i}`, name: `d${i}` })),
          total: 1001,
        };
      }
      return { departments: [{ id: "last", parent_id: "d0", name: "last" }], total: 1001 };
    });
    await run(["--json", "org", "tree"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchMock, 1).searchParams.get("offset")).toBe("1000");
    expect(urlOf(fetchMock, 1).searchParams.get("limit")).toBe("1000");
  });
});

describe("admin user", () => {
  it("list --org filters by department_id", async () => {
    const fetchMock = mockFetch({ users: [], total: 0 });
    await run(["user", "list", "--org", "d1"]);
    expect(urlOf(fetchMock).searchParams.get("department_id")).toBe("d1");
  });

  it("create refuses without an explicit password and sends nothing", async () => {
    const fetchMock = mockFetch({ id: "u1" });
    await expect(run(["user", "create", "--login", "bob"])).rejects.toThrow(/--password/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("create sends the password, telephone and departments it was given", async () => {
    const fetchMock = mockFetch({ id: "u1" });
    await run([
      "user",
      "create",
      "--login",
      "bob",
      "--password",
      "S3cret!",
      "--display-name",
      "Bob",
      "--tel",
      "123",
      "--department",
      "d1",
      "d2",
    ]);
    expect(bodyAt(fetchMock)).toEqual({
      account: "bob",
      password: "S3cret!",
      name: "Bob",
      telephone: "123",
      department_ids: ["d1", "d2"],
    });
  });

  it("create reads the password from BKN_NEW_USER_PASSWORD", async () => {
    process.env.BKN_NEW_USER_PASSWORD = "from-env";
    const fetchMock = mockFetch({ id: "u1" });
    await run(["user", "create", "--login", "bob"]);
    expect(bodyAt(fetchMock)).toEqual({ account: "bob", password: "from-env" });
  });

  it("update sends department_ids and drops the legacy-only flags", async () => {
    expect(optionsOf(["user", "update"])).not.toContain("--csf-level");
    expect(optionsOf(["user", "create"])).not.toContain("--priority");
    const fetchMock = mockFetch({});
    await run(["user", "update", "u1", "--department", "d3", "--tel", "9"]);
    expect(bodyAt(fetchMock)).toEqual({ telephone: "9", department_ids: ["d3"] });
  });
});

describe("admin role members", () => {
  it("names members found past the first user page", async () => {
    const fetchMock = mockFetchByPath((url) => {
      if (url.pathname.endsWith("/roles/r1/members")) return { accessor_ids: ["u-far"] };
      const offset = Number(url.searchParams.get("offset") ?? 0);
      if (offset === 0) {
        return {
          users: Array.from({ length: 500 }, (_, i) => ({ id: `u${i}`, account: `a${i}` })),
          total: 501,
        };
      }
      return { users: [{ id: "u-far", account: "far" }], total: 501 };
    });
    await run(["--json", "role", "members", "r1"]);
    const printed = vi
      .mocked(process.stdout.write)
      .mock.calls.map(([c]) => String(c))
      .join("");
    expect(JSON.parse(printed)).toEqual({ members: [{ account: "far", id: "u-far" }], total: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("admin llm list --type", () => {
  it("sends model_type like model llm list does", async () => {
    const fetchMock = mockFetch({ data: [], count: 0 });
    await run(["llm", "list", "--type", "vu"]);
    expect(urlOf(fetchMock).searchParams.get("model_type")).toBe("vu");
    expect(urlOf(fetchMock).searchParams.has("name")).toBe(false);
  });
});

describe("admin resource userCreate", () => {
  it("refuses an empty password before sending", async () => {
    const fetchMock = mockFetch({ id: "u1" });
    const { admin } = await import("../../src/resources/admin.js");
    const api = admin({ baseUrl: BASE, token: "t", insecure: false });
    await expect(api.userCreate({ loginName: "bob", password: "" })).rejects.toThrow(
      /initial password/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
