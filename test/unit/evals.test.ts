// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, describe, expect, it, vi } from "vitest";
import { EVAL_OPERATIONS } from "../../src/api/eval-operations.js";
import { createClient } from "../../src/client.js";
import { evals } from "../../src/resources/evals.js";
import type { RequestContext } from "../../src/types.js";
import { HttpError, InputError } from "../../src/utils/errors.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://example.test",
  token: "test-bearer",
  insecure: false,
});
const runToken = "a".repeat(64);
const runInput = { run_id: "run-1", run_token: runToken };
const view = {
  run_id: "run-1",
  agent: { name: "Codex", model: "self-reported" },
  execution_status: "running",
  planned_cases: 2,
  completed_cases: 0,
};
const task = {
  run_id: "run-1",
  done: false,
  case_run_id: "cr-1",
  case_id: "case-1",
  case_version: 1,
  title: "Material",
  question: "Find leadtime",
  task_token: "b".repeat(64),
  expires_at: "2026-11-06T08:00:00Z",
  bkn_context: { conversation_id: "conv-1", interaction_id: "int-1" },
};
function mockResponse(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(body === undefined ? undefined : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
function captured(fetch: ReturnType<typeof vi.fn>) {
  const call = fetch.mock.calls[0];
  if (!call) throw new Error("Expected an HTTP request.");
  return call;
}
afterEach(() => vi.unstubAllGlobals());

describe("quality Eval management", () => {
  it("exposes the resource on the public client without changing Trace helpers", () => {
    const client = createClient({ baseUrl: "https://example.test", token: "test-bearer" });
    expect(client.evals.forNetwork).toBeTypeOf("function");
    expect(client.trace.evalSetBuild).toBeTypeOf("function");
    expect(Object.keys(EVAL_OPERATIONS)).toHaveLength(48);
  });
  it("encodes identifiers and query strings while preserving integer observations", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response('{"observation":{"id":9007199254740993}}', {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await evals(ctx)
      .forNetwork("supply/中文")
      .request("getEvalCaseRun", {
        path: { run_id: "run/a", case_run_id: "cr?b" },
        query: { result_revision: 2, q: "A&B" },
      });
    const [url, init] = captured(fetch);
    expect(url.toString()).toContain(
      "/knowledge-networks/supply%2F%E4%B8%AD%E6%96%87/evals/runs/run%2Fa/cases/cr%3Fb?",
    );
    expect(new URL(url).searchParams.get("q")).toBe("A&B");
    expect(init.method).toBe("GET");
    expect(result).toEqual({ observation: { id: 9007199254740993n } });
  });
  it("sends monthly scheduling and optimistic revisions without renaming fields", async () => {
    const fetch = mockResponse({ revision: 5 });
    const body = {
      name: "Monthly",
      overlap_policy: "skip" as const,
      suite_id: "suite-1",
      version_policy: "latest" as const,
      revision: 4,
      schedule: {
        kind: "monthly" as const,
        day_of_month: 31,
        time_of_day: "09:00",
        timezone: "Asia/Shanghai",
      },
    };
    await evals(ctx)
      .forNetwork("kn")
      .request("updateEvalRunPlan", { path: { plan_id: "p1" }, body });
    expect(captured(fetch)[0].toString()).toBe(
      "https://example.test/api/bkn-backend/v1/knowledge-networks/kn/evals/run-plans/p1",
    );
    expect(captured(fetch)[1]).toMatchObject({
      method: "PUT",
      redirect: "manual",
      body: JSON.stringify(body),
    });
  });
  it("forwards structured rule checks and definition-only sample fields", async () => {
    let fetch = mockResponse({});
    const rules = {
      checksum: "catalog-checksum",
      revision: 1,
      rules: [{ id: "rule-1", check: { type: "instance_lookup" } }],
    };
    await evals(ctx).forNetwork("kn").request("saveEvalTemplateConfig", { body: rules });
    expect(JSON.parse(captured(fetch)[1].body)).toEqual(rules);
    fetch = mockResponse({});
    const samples = {
      samples: [{ definition_only: true, assertions: [{ op: "exists" }], arguments: {} }],
    };
    await evals(ctx).forNetwork("kn").request("previewEvalRuleApplication", { body: samples });
    expect(JSON.parse(captured(fetch)[1].body)).toEqual(samples);
    fetch = mockResponse({});
    await evals(ctx).forNetwork("kn").request("saveEvalRuleApplication", { body: samples });
    expect(JSON.parse(captured(fetch)[1].body)).toEqual(samples);
  });
  it("accepts a 204 delete without trying to parse an object", async () => {
    mockResponse(undefined, 204);
    await expect(
      evals(ctx)
        .forNetwork("kn")
        .request("deleteEvalSuite", { path: { suite_id: "s1" } }),
    ).resolves.toBeUndefined();
  });
  it("refuses traversal and missing path parameters before network I/O", () => {
    const fetch = mockResponse({});
    expect(() => evals(ctx).forNetwork("..").request("getEvalCapabilities", {})).toThrow(
      InputError,
    );
    expect(() =>
      evals(ctx)
        .forNetwork("kn")
        .request("getEvalRun", { path: {} } as never),
    ).toThrow(/Missing Eval path parameter/);
    expect(() =>
      evals(ctx)
        .forNetwork("kn")
        .request("toString" as never, {} as never),
    ).toThrow(InputError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("external participant protocol", () => {
  it("discovers suites and preserves page/limit", async () => {
    const fetch = mockResponse({
      entries: [
        { suite_id: "s", name: "Supply", version: 3, case_count: 2, members_sha256: "sha" },
      ],
      page: 2,
      limit: 10,
    });
    await evals(ctx).participant.listSuites("kn", { query: "Supply", page: 2, limit: 10 });
    expect(JSON.parse(captured(fetch)[1].body)).toEqual({
      name: "bkn_eval_list_suites",
      arguments: { kn_id: "kn", query: "Supply", page: 2, limit: 10 },
    });
  });
  it("requires a run credential on start and retains the supplied idempotency key", async () => {
    const fetch = mockResponse({ ...view, run_token: runToken });
    const input = {
      suite_id: "s1",
      version: 2,
      agent: { name: "Codex", model: "self-reported" },
      idempotency_key: "stable-request-key",
    };
    const result = await evals(ctx).participant.startRun("kn", input);
    expect(result.run_token).toBe(runToken);
    expect(JSON.parse(captured(fetch)[1].body)).toEqual({
      name: "bkn_eval_start_run",
      arguments: { ...input, kn_id: "kn" },
    });
    expect(captured(fetch)[1]).toMatchObject({
      redirect: "manual",
      headers: expect.objectContaining({ authorization: "Bearer test-bearer" }),
    });
    mockResponse(view);
    await expect(evals(ctx).participant.startRun("kn", input)).rejects.toThrow();
  });
  it("claims platform context and supports done without task fields", async () => {
    mockResponse(task);
    await expect(evals(ctx).participant.nextCase("kn", runInput)).resolves.toMatchObject({
      bkn_context: { interaction_id: "int-1" },
    });
    mockResponse({ run_id: "run-1", done: true });
    await expect(evals(ctx).participant.nextCase("kn", runInput)).resolves.toEqual({
      run_id: "run-1",
      done: true,
    });
    mockResponse({ run_id: "run-1", done: false });
    await expect(evals(ctx).participant.nextCase("kn", runInput)).rejects.toThrow();
  });
  it("submits only business output, preserving large integers and task credentials", async () => {
    const fetch = mockResponse(view);
    await evals(ctx).participant.submitResult("kn", {
      ...runInput,
      case_run_id: "cr-1",
      task_token: task.task_token,
      answer: "Found it",
      structured_output: { id: 9007199254740993n },
    });
    expect(captured(fetch)[0].toString()).toBe(
      "https://example.test/api/bkn-backend/v1/eval-mcp/call",
    );
    expect(captured(fetch)[1].body).toContain('"id":9007199254740993');
    expect(JSON.parse(captured(fetch)[1].body)).toMatchObject({
      name: "bkn_eval_submit_result",
      arguments: { task_token: task.task_token },
    });
  });
  it("reads aggregate progress without requiring another run token in the response", async () => {
    const fetch = mockResponse({ ...view, completed_cases: 1 });
    await expect(evals(ctx).participant.getProgress("kn", runInput)).resolves.toMatchObject({
      completed_cases: 1,
    });
    expect(JSON.parse(captured(fetch)[1].body).name).toBe("bkn_eval_get_progress");
  });
  it("rejects missing credentials, oversized UTF-8 answers and client self-grading", async () => {
    const fetch = mockResponse(view);
    const valid = {
      ...runInput,
      case_run_id: "cr",
      task_token: task.task_token,
      answer: "ok",
      structured_output: {},
    };
    await expect(
      evals(ctx).participant.submitResult("kn", { ...valid, answer: "汉".repeat(90000) }),
    ).rejects.toThrow();
    await expect(
      evals(ctx).participant.submitResult("kn", {
        ...valid,
        structured_output: { text: "x".repeat(262145) },
      }),
    ).rejects.toThrow();
    await expect(
      evals(ctx).participant.submitResult("kn", { ...valid, score: 100 } as never),
    ).rejects.toThrow();
    await expect(
      evals(ctx).participant.nextCase("kn", { ...runInput, run_token: "" }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("propagates permission and conflict errors without retrying or switching APIs", async () => {
    for (const status of [403, 409]) {
      const fetch = mockResponse({ code: "EVAL_TASK_CONFLICT" }, status);
      await expect(evals(ctx).participant.getProgress("kn", runInput)).rejects.toBeInstanceOf(
        HttpError,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("honors cancellation before issuing a request", async () => {
    const fetch = mockResponse(view);
    const controller = new AbortController();
    controller.abort();
    await expect(
      evals(ctx).participant.getProgress("kn", runInput, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
