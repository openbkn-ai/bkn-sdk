import { afterEach, describe, expect, it, vi } from "vitest";
import { getDataflowLogs, listDataflowRuns, listDataflows } from "../../src/api/dataflow.js";
import type { RequestContext } from "../../src/types.js";

const ctx: RequestContext = {
  baseUrl: "https://demo.example.com",
  token: "t",
  businessDomain: "bd_public",
  insecure: false,
};

type CallArgs = [string, RequestInit];
function mockFetch(): typeof fetch {
  const fn = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function url(fetchMock: typeof fetch): URL {
  const args = (fetchMock as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0];
  if (!args) throw new Error("fetch not called");
  return new URL(args[0]);
}
afterEach(() => vi.unstubAllGlobals());

describe("dataflow read endpoints (automation v2)", () => {
  it("list hits /dags with data-flow filter", async () => {
    const f = mockFetch();
    await listDataflows(ctx);
    const u = url(f);
    expect(u.pathname).toBe("/api/automation/v2/dags");
    expect(u.searchParams.get("type")).toBe("data-flow");
    expect(u.searchParams.get("limit")).toBe("-1");
  });

  it("runs hits /dag/{id}/results", async () => {
    const f = mockFetch();
    await listDataflowRuns(ctx, "dag 1");
    expect(url(f).pathname).toBe("/api/automation/v2/dag/dag%201/results");
  });

  it("logs hits /dag/{id}/result/{instance} with paging", async () => {
    const f = mockFetch();
    await getDataflowLogs(ctx, "d1", "i1", { page: 2, limit: 10 });
    const u = url(f);
    expect(u.pathname).toBe("/api/automation/v2/dag/d1/result/i1");
    expect(u.searchParams.get("page")).toBe("2");
    expect(u.searchParams.get("limit")).toBe("10");
  });
});
