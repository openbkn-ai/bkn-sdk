import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiscoverSchedule,
  deleteDiscoverTasks,
  discoverCatalog,
  getDiscoverSchedule,
  listDiscoverSchedules,
  listDiscoverTasks,
  updateDiscoverSchedule,
} from "../../src/api/vega-discovery.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

type CallArgs = [string, RequestInit];
function mockFetch(body: unknown = {}): typeof fetch {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function calls(fetchMock: typeof fetch): CallArgs[] {
  return (fetchMock as unknown as { mock: { calls: CallArgs[] } }).mock.calls;
}

const account = { id: "u-1", type: "user" };
const schedule = {
  id: "s-1",
  name: "hourly",
  catalog_id: "c-1",
  cron_expr: "0 * * * *",
  enabled: false,
  strategy: "full_sync",
  creator: account,
  create_time: 10,
  updater: account,
  update_time: 20,
};

afterEach(() => vi.unstubAllGlobals());

describe("DiscoverSchedule APIs", () => {
  it("maps list filters and parses update_time", async () => {
    const f = mockFetch({ entries: [schedule], total_count: 1 });
    await expect(
      listDiscoverSchedules(ctx, {
        catalogId: "c-1",
        enabled: false,
        sort: "next_run",
        direction: "asc",
      }),
    ).resolves.toMatchObject({ entries: [{ update_time: 20 }] });
    const url = new URL(calls(f)[0]?.[0] ?? "");
    expect(url.searchParams.get("catalog_id")).toBe("c-1");
    expect(url.searchParams.get("enabled")).toBe("false");
    expect(url.searchParams.get("sort")).toBe("next_run");
    expect(url.searchParams.get("limit")).toBe("30");
  });

  it("creates, gets, and strictly updates a schedule with its expected version", async () => {
    const f = mockFetch({ id: "s-1" });
    await createDiscoverSchedule(ctx, {
      name: "hourly",
      catalogId: "c-1",
      cronExpr: "0 * * * *",
      enabled: true,
    });
    expect(JSON.parse(calls(f)[0]?.[1].body as string)).toEqual({
      name: "hourly",
      catalog_id: "c-1",
      cron_expr: "0 * * * *",
      enabled: true,
    });

    mockFetch(schedule);
    await expect(getDiscoverSchedule(ctx, "s/1")).resolves.toMatchObject({ update_time: 20 });

    const updateFetch = mockFetch();
    await updateDiscoverSchedule(ctx, "s-1", {
      name: "daily",
      catalogId: "c-1",
      cronExpr: "0 0 * * *",
      enabled: false,
      startTime: 0,
      endTime: 0,
      strategy: "create_only",
      expectedUpdateTime: 20,
    });
    expect(JSON.parse(calls(updateFetch)[0]?.[1].body as string)).toEqual({
      name: "daily",
      catalog_id: "c-1",
      cron_expr: "0 0 * * *",
      enabled: false,
      start_time: 0,
      end_time: 0,
      strategy: "create_only",
      expected_update_time: 20,
    });
  });
});

describe("DiscoverTask APIs", () => {
  it("lists tasks with repeated statuses", async () => {
    const f = mockFetch({ entries: [], total_count: 0 });
    await listDiscoverTasks(ctx, { status: ["pending", "running"], scheduleId: "s-1" });
    const url = new URL(calls(f)[0]?.[0] ?? "");
    expect(url.searchParams.getAll("status")).toEqual(["pending", "running"]);
    expect(url.searchParams.get("schedule_id")).toBe("s-1");
  });

  it("triggers a task and encodes batch deletion ids separately", async () => {
    const triggerFetch = mockFetch({ id: "t-1" });
    await expect(discoverCatalog(ctx, "c/1", { strategy: "cleanup_only" })).resolves.toEqual({
      id: "t-1",
    });
    expect(new URL(calls(triggerFetch)[0]?.[0] ?? "").pathname).toContain(
      "/catalogs/c%2F1/discover",
    );
    expect(JSON.parse(calls(triggerFetch)[0]?.[1].body as string)).toEqual({
      strategy: "cleanup_only",
    });

    const deleteFetch = mockFetch();
    await deleteDiscoverTasks(ctx, ["t/1", "t 2"], { ignoreMissing: true });
    const url = new URL(calls(deleteFetch)[0]?.[0] ?? "");
    expect(url.pathname).toContain("/discover-tasks/t%2F1,t%202");
    expect(url.searchParams.get("ignore_missing")).toBe("true");
  });
});
