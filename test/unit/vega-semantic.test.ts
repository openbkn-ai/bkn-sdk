import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applySemanticUnderstandingTask,
  createSemanticUnderstandingTask,
  deleteSemanticUnderstandingTasks,
  getSemanticUnderstandingTask,
  listSemanticUnderstandingTasks,
} from "../../src/api/vega-semantic.js";
import { createClient } from "../../src/client.js";
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
  it.each(["en-US", "zh-CN"] as const)("forwards explicit output language %s", async (language) => {
    const f = mockFetch(task);
    await createSemanticUnderstandingTask(ctx, { scope: "resource", resourceId: "r-1", language });
    expect(JSON.parse(firstCall(f)[1].body as string)).toMatchObject({ language });
  });

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

  it.each(["fill_empty", "force"] as const)(
    "applies a saved result with %s while retaining the original task mode",
    async (applyMode) => {
      const savedResult = '{"fields":[{"name":"order_id","display_name":"Order"}]}';
      const response = {
        ...task,
        status: "completed",
        apply_mode: "dry_run",
        result_json: savedResult,
        confidence: 0.9,
        applied: true,
        apply_detail_json: JSON.stringify({ apply_mode: applyMode }),
      };
      const f = mockFetch(response);
      await expect(
        applySemanticUnderstandingTask(ctx, "st/1", { applyMode }),
      ).resolves.toMatchObject({
        apply_mode: "dry_run",
        result_json: savedResult,
        applied: true,
        apply_detail_json: response.apply_detail_json,
      });
      const [url, init] = firstCall(f);
      expect(new URL(url).pathname).toBe(
        "/api/vega-backend/v1/semantic-understanding-tasks/st%2F1/apply",
      );
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ apply_mode: applyMode });
      expect(f).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves successful application with no resource changes through the public client", async () => {
    const client = createClient({ baseUrl: ctx.baseUrl, token: "t" });
    verifiedContext(client.ctx);
    const response = {
      ...task,
      status: "completed",
      apply_mode: "dry_run",
      confidence: 0.9,
      applied: true,
      apply_detail_json: '{"apply_mode":"fill_empty","reason":"no_resource_changes"}',
    };
    const f = mockFetch(response);
    await expect(
      client.vega.applySemanticUnderstandingTask("st-1", { applyMode: "fill_empty" }),
    ).resolves.toEqual(response);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("propagates a schema mismatch without recreating or retrying the task", async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error_code: "VegaBackend.SemanticUnderstandingTask.SchemaMismatch",
            description: "Resource schema has changed",
          }),
          { status: 409 },
        ),
    );
    vi.stubGlobal("fetch", f);
    await expect(
      applySemanticUnderstandingTask(ctx, "st-1", { applyMode: "force" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(f).toHaveBeenCalledTimes(1);
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
