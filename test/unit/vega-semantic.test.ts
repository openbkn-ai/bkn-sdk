import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSemanticUnderstandingTask,
  deleteSemanticUnderstandingTasks,
  getSemanticUnderstandingTask,
  listSemanticUnderstandingTasks,
} from "../../src/api/vega-semantic.js";
import type { RequestContext } from "../../src/types.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});
type CallArgs = [string, RequestInit];
function mockFetch(body: unknown = {}): typeof fetch {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn as unknown as typeof fetch;
}
function firstCall(fetchMock: typeof fetch): CallArgs {
  return (fetchMock as unknown as { mock: { calls: CallArgs[] } }).mock.calls[0]!;
}

const task = {
  id: "st-1",
  scope: "resource",
  catalog_id: "c-1",
  resource_id: "r-1",
  agent_id: "a-1",
  input: "{}",
  input_hash: "hash",
  status: "pending",
  apply_mode: "fill_empty",
  confidence_threshold: 0.75,
  confidence: 0,
  applied: false,
  creator: { id: "u-1", type: "user" },
  create_time: 10,
};

afterEach(() => vi.unstubAllGlobals());

describe("SemanticUnderstandingTask APIs", () => {
  it("creates a resource task with sample options", async () => {
    const f = mockFetch(task);
    await expect(
      createSemanticUnderstandingTask(ctx, {
        scope: "resource",
        resourceId: "r-1",
        applyMode: "force",
        confidenceThreshold: 0.9,
        includeSampleRows: true,
        samplePolicy: { masked: false, maxRows: 5 },
      }),
    ).resolves.toMatchObject({ id: "st-1", status: "pending" });
    expect(JSON.parse(firstCall(f)[1].body as string)).toEqual({
      scope: "resource",
      resource_id: "r-1",
      apply_mode: "force",
      confidence_threshold: 0.9,
      include_sample_rows: true,
      sample_policy: { masked: false, max_rows: 5 },
    });
  });

  it("lists with repeated statuses and boolean applied", async () => {
    const f = mockFetch({ entries: [], total_count: 0 });
    await listSemanticUnderstandingTasks(ctx, {
      status: ["completed", "failed"],
      applied: false,
    });
    const url = new URL(firstCall(f)[0]);
    expect(url.searchParams.getAll("status")).toEqual(["completed", "failed"]);
    expect(url.searchParams.get("applied")).toBe("false");
  });

  it("gets and deletes task ids", async () => {
    const getFetch = mockFetch(task);
    await expect(getSemanticUnderstandingTask(ctx, "st-1")).resolves.toMatchObject({
      id: "st-1",
    });
    expect(new URL(firstCall(getFetch)[0]).pathname).toContain(
      "/semantic-understanding-tasks/st-1",
    );

    const deleteFetch = mockFetch();
    await deleteSemanticUnderstandingTasks(ctx, ["st-1", "st-2"], { ignoreMissing: true });
    const url = new URL(firstCall(deleteFetch)[0]);
    expect(url.pathname).toContain("/semantic-understanding-tasks/st-1,st-2");
    expect(url.searchParams.get("ignore_missing")).toBe("true");
  });
});
