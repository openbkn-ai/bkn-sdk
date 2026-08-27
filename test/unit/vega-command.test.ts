import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { vegaCommand } from "../../src/commands/vega.js";

function cli(): Command {
  const root = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <t>");
  root.addCommand(vegaCommand());
  return root;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetch(body: unknown = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function suppressOutput(): void {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

describe("vega catalog delete", () => {
  it("forwards --dry-run to the backend", async () => {
    const fetchMock = mockFetch({
      catalog_id: "c-1",
      can_delete: true,
      blockers: [],
      resources: 1,
      protected_resources: 0,
      build_tasks: { will_cancel: 0, blocking: 0 },
      catalog_health_check_schedules: 1,
      discover_schedules: 1,
      discover_tasks: { will_cancel: 0, blocking: 0 },
      semantic_understanding_tasks: { will_cancel: 0, blocking: 0 },
    });
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "catalog",
        "delete",
        "c-1",
        "--dry-run",
      ],
      { from: "user" },
    );

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get("dry_run")).toBe("true");
  });
});

describe("vega resource document input", () => {
  it("preserves unsafe integers in document-create data", async () => {
    const fetchMock = mockFetch({ ids: [] });
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "resource",
        "document-create",
        "r-1",
        "--data",
        '[{"id":"doc-1","id_card":110101199001152345}]',
      ],
      { from: "user" },
    );

    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain("110101199001152345");
  });
});

describe("vega resource discovery commands", () => {
  it("triggers a resource discovery task without a strategy body", async () => {
    const fetchMock = mockFetch({ id: "t-1" });
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "resource",
        "discover",
        "r/1",
      ],
      { from: "user" },
    );

    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).pathname).toBe(
      "/api/vega-backend/v1/resources/r%2F1/discover",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it("forwards resource enabled-state actions and task resource filters", async () => {
    const fetchMock = mockFetch({ entries: [], total_count: 0 });
    suppressOutput();
    const base = ["--base-url", "https://demo.example.com", "--token", "t", "vega"];

    await cli().parseAsync([...base, "resource", "enable", "r-1"], { from: "user" });
    await cli().parseAsync([...base, "resource", "disable", "r-1"], { from: "user" });
    await cli().parseAsync([...base, "discover-task", "list", "--resource-id", "r-1"], {
      from: "user",
    });

    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).pathname).toBe(
      "/api/vega-backend/v1/resources/r-1/enable",
    );
    expect(new URL(fetchMock.mock.calls[1]?.[0] as string).pathname).toBe(
      "/api/vega-backend/v1/resources/r-1/disable",
    );
    expect(new URL(fetchMock.mock.calls[2]?.[0] as string).searchParams.get("resource_id")).toBe(
      "r-1",
    );
  });
});

describe("vega optimistic updates", () => {
  it("requires an optimistic-lock version for every Vega PUT command", async () => {
    suppressOutput();
    const base = ["--base-url", "https://demo.example.com", "--token", "t", "vega"];

    await expect(
      cli().parseAsync(
        [
          ...base,
          "catalog",
          "update",
          "c-1",
          "--name",
          "catalog",
          "--connector-type",
          "mysql",
          "--enabled",
          "false",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow();
    await expect(
      cli().parseAsync(
        [...base, "catalog", "set-health-check-schedule", "c-1", "--mode", "disabled"],
        {
          from: "user",
        },
      ),
    ).rejects.toThrow();
    await expect(
      cli().parseAsync(
        [
          ...base,
          "discover-schedule",
          "update",
          "s-1",
          "--name",
          "hourly",
          "--catalog-id",
          "c-1",
          "--cron",
          "0 * * * *",
          "--enabled",
          "false",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow();
    await expect(
      cli().parseAsync(
        [
          ...base,
          "discover-schedule",
          "update",
          "s-1",
          "--name",
          "hourly",
          "--catalog-id",
          "c-1",
          "--cron",
          "0 * * * *",
          "--enabled",
          "false",
          "--start-time",
          "0",
          "--end-time",
          "0",
          "--expected-update-time",
          "1720000000789",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow();
  });

  it("forwards the catalog update version", async () => {
    const fetchMock = mockFetch();
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "catalog",
        "update",
        "c-1",
        "--name",
        "catalog",
        "--connector-type",
        "mysql",
        "--enabled",
        "false",
        "--expected-update-time",
        "1720000000123",
      ],
      { from: "user" },
    );

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      expected_update_time: 1720000000123,
    });
  });

  it("forwards the health-check schedule update version", async () => {
    const fetchMock = mockFetch({
      catalog_id: "c-1",
      mode: "disabled",
      last_run: 0,
      next_run: 0,
      update_time: 1720000000456,
    });
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "catalog",
        "set-health-check-schedule",
        "c-1",
        "--mode",
        "disabled",
        "--expected-update-time",
        "1720000000456",
      ],
      { from: "user" },
    );

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      mode: "disabled",
      expected_update_time: 1720000000456,
    });
  });

  it("forwards the discover schedule update version and immutable state", async () => {
    const fetchMock = mockFetch();
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "discover-schedule",
        "update",
        "s-1",
        "--name",
        "hourly",
        "--catalog-id",
        "c-1",
        "--cron",
        "0 * * * *",
        "--enabled",
        "false",
        "--start-time",
        "0",
        "--end-time",
        "0",
        "--strategy",
        "create_only",
        "--expected-update-time",
        "1720000000789",
      ],
      { from: "user" },
    );

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      catalog_id: "c-1",
      enabled: false,
      start_time: 0,
      end_time: 0,
      strategy: "create_only",
      expected_update_time: 1720000000789,
    });
  });

  it("reports an invalid required discover schedule strategy as input error", async () => {
    suppressOutput();
    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "vega",
          "discover-schedule",
          "update",
          "s-1",
          "--name",
          "hourly",
          "--catalog-id",
          "c-1",
          "--cron",
          "0 * * * *",
          "--enabled",
          "false",
          "--start-time",
          "0",
          "--end-time",
          "0",
          "--strategy",
          "unknown",
          "--expected-update-time",
          "1720000000789",
        ],
        { from: "user" },
      ),
    ).rejects.toMatchObject({
      name: "InputError",
      message: expect.stringMatching(/invalid discover strategy/),
    });
  });
});

describe("vega lifecycle and document commands", () => {
  it("rejects invalid task filters before making a request", async () => {
    suppressOutput();
    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "vega",
          "discover-task",
          "list",
          "--status",
          "unknown",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/invalid task status/);
    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "vega",
          "discover-task",
          "list",
          "--trigger-type",
          "automatic",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/invalid discover task trigger type/);
    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "vega",
          "semantic-task",
          "list",
          "--sort",
          "updated_at",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/invalid semantic task sort/);
  });

  it("rejects invalid numeric arguments before serializing them", async () => {
    suppressOutput();
    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "vega",
          "semantic-task",
          "create",
          "--scope",
          "catalog",
          "--catalog-id",
          "c-1",
          "--confidence-threshold",
          "not-a-number",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/confidence-threshold/);
    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "vega",
          "discover-schedule",
          "list",
          "--limit",
          "not-an-integer",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/expected an integer/);
  });

  it("triggers asynchronous discovery with a strategy and no legacy wait query", async () => {
    const fetchMock = mockFetch({ id: "task-1" });
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "catalog",
        "discover",
        "c-1",
        "--strategy",
        "create_only",
      ],
      { from: "user" },
    );

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.searchParams.has("wait")).toBe(false);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      strategy: "create_only",
    });
  });

  it("lists discovery tasks with repeated statuses", async () => {
    const fetchMock = mockFetch({ entries: [], total_count: 0 });
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "discover-task",
        "list",
        "--status",
        "pending,running",
      ],
      { from: "user" },
    );

    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams.getAll("status")).toEqual([
      "pending",
      "running",
    ]);
  });

  it("creates dataset documents with the POST override", async () => {
    const fetchMock = mockFetch({ ids: ["d-1"] });
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "resource",
        "document-create",
        "r-1",
        "--data",
        '[{"title":"hello"}]',
      ],
      { from: "user" },
    );

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("X-HTTP-Method-Override")).toBe(
      "POST",
    );
  });
});

describe("vega sql", () => {
  it("preserves an unsafe BIGINT in --data", async () => {
    const fetchMock = mockFetch({ entries: [] });
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "sql",
        "--data",
        '{"query_format":"dsl","input_dialect":"opensearch","query":{"term":{"id_card":110101199001152345}}}',
      ],
      { from: "user" },
    );

    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain("110101199001152345");
  });
});

describe("vega dataset build-list", () => {
  it("expands comma-separated statuses into repeated query parameters", async () => {
    const fetchMock = mockFetch({ entries: [], total_count: 0 });
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "dataset",
        "build-list",
        "--status",
        "pending,running",
      ],
      { from: "user" },
    );

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.searchParams.getAll("status")).toEqual(["pending", "running"]);
  });

  it("rejects an empty status list before issuing a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "vega",
          "dataset",
          "build-list",
          "--status",
          ",",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/at least one build status/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an explicitly empty status value before issuing a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "vega",
          "dataset",
          "build-list",
          "--status",
          "",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/at least one build status/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the invalid status and the schema-derived allowed values", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "vega",
          "dataset",
          "build-list",
          "--status",
          "queued",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(
      'invalid build status "queued"; expected one of pending, running, stopping, stopped, completed, failed, cancelled',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects the removed --active option", async () => {
    suppressOutput();
    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "vega",
          "dataset",
          "build-list",
          "--active",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow();
  });

  it("sends the shared sort and direction parameters", async () => {
    const fetchMock = mockFetch({ entries: [], total_count: 0 });
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "vega",
        "dataset",
        "build-list",
        "--sort",
        "finish_time",
        "--direction",
        "asc",
      ],
      { from: "user" },
    );

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get("sort")).toBe("finish_time");
    expect(url.searchParams.get("direction")).toBe("asc");
    expect(url.searchParams.has("order_by")).toBe(false);
    expect(url.searchParams.has("order")).toBe(false);
  });

  it("rejects invalid sort and direction values before issuing a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    suppressOutput();

    const invalidOptions = [
      ["--sort", "created_at", /invalid build task sort/],
      ["--sort", "update_time", /invalid build task sort/],
      ["--direction", "up", /invalid sort direction/],
    ] as const;
    for (const [flag, value, message] of invalidOptions) {
      await expect(
        cli().parseAsync(
          [
            "--base-url",
            "https://demo.example.com",
            "--token",
            "t",
            "vega",
            "dataset",
            "build-list",
            flag,
            value,
          ],
          { from: "user" },
        ),
      ).rejects.toThrow(message);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
