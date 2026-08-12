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

  it("rejects the removed default ordering before issuing a request", async () => {
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
          "--order-by",
          "default",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/--order-by default is no longer supported/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
