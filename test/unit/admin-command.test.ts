import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  writeVersionCheckCache(BASE, { serverVersion: "0.1.5", checkedAt: new Date().toISOString() });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin audit", () => {
  it("list maps every flag onto the audit-logs query (previously always refused)", async () => {
    const fetchMock = mockFetch({ logs: [], total: 0 });
    await run([
      "audit",
      "list",
      "--actor-id",
      "u-1",
      "--request-id",
      "req-1",
      "--resource",
      "users",
      "--action",
      "create",
      "--target-id",
      "t-1",
      "--failed-only",
      "--from",
      "2026-09-01T00:00:00Z",
      "--to",
      "2026-09-02T00:00:00Z",
      "--before-id",
      "a-9",
      "--offset",
      "20",
      "--limit",
      "100",
    ]);
    const url = urlOf(fetchMock);
    expect(url.pathname).toBe("/api/safe/v1/admin/audit-logs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      actor_id: "u-1",
      request_id: "req-1",
      resource: "users",
      action: "create",
      target_id: "t-1",
      failed_only: "true",
      from: "2026-09-01T00:00:00Z",
      to: "2026-09-02T00:00:00Z",
      before_id: "a-9",
      offset: "20",
      limit: "100",
    });
  });

  it("list defaults to the CLI list limit and accepts --start/--end as aliases", async () => {
    const fetchMock = mockFetch({ logs: [], total: 0 });
    await run([
      "audit",
      "list",
      "--start",
      "2026-09-01T00:00:00Z",
      "--end",
      "2026-09-02T00:00:00Z",
    ]);
    expect(Object.fromEntries(urlOf(fetchMock).searchParams)).toEqual({
      from: "2026-09-01T00:00:00Z",
      to: "2026-09-02T00:00:00Z",
      limit: "30",
    });
  });

  it("list refuses --limit above 500 without sending", async () => {
    const fetchMock = mockFetch({ logs: [], total: 0 });
    await expect(run(["audit", "list", "--limit", "501"])).rejects.toThrow(/between 0 and 500/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("list no longer offers the unmappable --user/--page/--size", () => {
    const list = adminCommand()
      .commands.find((c) => c.name() === "audit")
      ?.commands.find((c) => c.name() === "list");
    const visible = list?.options.filter((o) => !o.hidden).map((o) => o.long);
    expect(visible).not.toEqual(expect.arrayContaining(["--user"]));
    expect(visible).not.toEqual(expect.arrayContaining(["--page"]));
    expect(visible).not.toEqual(expect.arrayContaining(["--size"]));
    expect(list?.description()).toMatch(/audit log entries/);
  });

  it("get reads one entry by id", async () => {
    const fetchMock = mockFetch({ id: "a-1" });
    await run(["audit", "get", "a-1"]);
    expect(urlOf(fetchMock).pathname).toBe("/api/safe/v1/admin/audit-logs/a-1");
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
