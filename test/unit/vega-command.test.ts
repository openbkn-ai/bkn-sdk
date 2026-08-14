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
        "update_time",
        "--direction",
        "asc",
      ],
      { from: "user" },
    );

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get("sort")).toBe("update_time");
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
