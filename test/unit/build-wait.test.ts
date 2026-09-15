// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildTask } from "../../src/api/vega.js";
import { vegaCommand } from "../../src/commands/vega.js";
import { writeVersionCheckCache } from "../../src/config/store.js";
import { vega } from "../../src/resources/vega.js";
import type { RequestContext } from "../../src/types.js";
import {
  buildProgressReporter,
  describeBuildProgress,
  formatDuration,
} from "../../src/utils/build-progress.js";
import { InputError, WaitTimeoutError } from "../../src/utils/errors.js";
import { verifiedContext } from "../setup/verified-context.js";

const BASE = "https://demo.example.com";
const ctx = verifiedContext<RequestContext>({ baseUrl: BASE, token: "t", insecure: false });

/** Serve `GET /build-tasks/<id>` from a sequence of states; the last one repeats. */
function tasks(...states: Array<Partial<BuildTask>>) {
  const fetch = vi.fn(async () => {
    const state = states.length > 1 ? states.shift() : states[0];
    return new Response(JSON.stringify({ id: "t-1", ...state }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("waitForBuild", () => {
  it.each(["running", "completed"] as const)(
    "waits the full short timeout and observes the final %s state",
    async (status) => {
      vi.useFakeTimers();
      const started = Date.now();
      const fetch = tasks({ status: "running" }, { status });
      const settled = vi.fn();
      // Handle both outcomes immediately, including a premature rejection.
      const result = vega(ctx)
        .waitForBuild("t-1", { timeoutMs: 1000 })
        .then(
          (task) => ({ task }),
          (error: unknown) => ({ error }),
        )
        .then((outcome) => {
          settled();
          return outcome;
        });

      await vi.advanceTimersByTimeAsync(999);
      expect(fetch).toHaveBeenCalledOnce();
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const outcome = await result;
      expect(Date.now() - started).toBe(1000);
      expect(fetch).toHaveBeenCalledTimes(2);
      if (status === "completed") {
        expect(outcome).toMatchObject({ task: { status: "completed" } });
      } else {
        expect(outcome).toMatchObject({
          error: expect.objectContaining({ last: { id: "t-1", status: "running" } }),
        });
        expect("error" in outcome && outcome.error).toBeInstanceOf(WaitTimeoutError);
      }
    },
  );

  it("polls until the task ends, reporting every state it saw", async () => {
    tasks({ status: "pending" }, { status: "running", synced_count: 5 }, { status: "completed" });
    const seen: string[] = [];
    const task = await vega(ctx).waitForBuild("t-1", {
      intervalMs: 0,
      onProgress: (t) => seen.push(String(t.status)),
    });
    expect(task.status).toBe("completed");
    expect(seen).toEqual(["pending", "running", "completed"]);
  });

  it("returns a failed task rather than throwing: it did end", async () => {
    tasks({ status: "failed", error_msg: "embedding model not found" } as Partial<BuildTask>);
    await expect(vega(ctx).waitForBuild("t-1", { intervalMs: 0 })).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("throws on running out of time, carrying the state it was last seen in", async () => {
    // Regression: a timeout used to return the running task, and the CLI exited 0.
    tasks({ status: "running", synced_count: 40, total_count: 100 });
    const err = await vega(ctx)
      .waitForBuild("t-1", { timeoutMs: 1, intervalMs: 50 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WaitTimeoutError);
    expect((err as WaitTimeoutError).last).toMatchObject({ status: "running", synced_count: 40 });
    expect((err as Error).message).toMatch(/still running .*build-task get t-1 --wait/);
  });

  it("waits without a limit at timeoutMs 0", async () => {
    const fetch = tasks({ status: "running" }, { status: "running" }, { status: "completed" });
    await vega(ctx).waitForBuild("t-1", { timeoutMs: 0, intervalMs: 0 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["timeoutMs", -1],
    ["timeoutMs", Number.NaN],
    ["timeoutMs", Number.POSITIVE_INFINITY],
    ["intervalMs", -1],
    ["intervalMs", Number.NaN],
    ["intervalMs", Number.POSITIVE_INFINITY],
  ] as const)("rejects an invalid SDK %s before any request", async (key, value) => {
    const fetch = tasks({ status: "completed" });

    const error = await vega(ctx)
      .waitForBuild("t-1", { [key]: value })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InputError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("vega build-task get --wait", () => {
  beforeEach(() => {
    writeVersionCheckCache(BASE, { serverVersion: "0.1.5", checkedAt: new Date().toISOString() });
  });

  function run(...args: string[]) {
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      stdout.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const root = new Command("openbkn")
      .exitOverride()
      .option("--base-url <url>")
      .option("--token <t>")
      .option("--json");
    root.addCommand(vegaCommand());
    const done = root.parseAsync(
      ["--base-url", BASE, "--token", "t", "--json", "vega", "build-task", "get", "t-1", ...args],
      { from: "user" },
    );
    return { done, stdout };
  }

  it("prints the finished task and succeeds when it completed", async () => {
    tasks({ status: "completed", synced_count: 10, total_count: 10 });
    const { done, stdout } = run("--wait");
    await expect(done).resolves.toBeDefined();
    expect(JSON.parse(stdout.join(""))).toMatchObject({ id: "t-1", status: "completed" });
  });

  it("fails, naming the reason, when the task ended without building", async () => {
    tasks({ status: "failed", error_msg: "embedding model not found" } as Partial<BuildTask>);
    const { done, stdout } = run("--wait");
    await expect(done).rejects.toThrow("BuildTask t-1 ended failed: embedding model not found");
    // Still printed: the id and state are what the caller acts on next.
    expect(JSON.parse(stdout.join(""))).toMatchObject({ status: "failed" });
  });

  it("fails on timeout and prints the task as it was last seen", async () => {
    tasks({ status: "running", synced_count: 3, total_count: 9 });
    const { done, stdout } = run("--wait", "--timeout", "1");
    await expect(done).rejects.toBeInstanceOf(WaitTimeoutError);
    expect(JSON.parse(stdout.join(""))).toMatchObject({ status: "running", synced_count: 3 });
  });

  it("rejects a negative timeout before any request", async () => {
    const fetch = tasks({ status: "completed" });
    const { done } = run("--wait", "--timeout", "-5");
    await expect(done).rejects.toThrow(/--timeout must be a whole number/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("build progress line", () => {
  it("reads rows, percentage, elapsed and time left", () => {
    expect(
      describeBuildProgress(
        { id: "t-1", status: "running", synced_count: 12_340, total_count: 50_000 },
        72_000,
        220_000,
      ),
    ).toBe("BuildTask t-1: running · 12,340/50,000 rows (24%) · 1m12s elapsed · ~3m40s left");
    expect(formatDuration(3_725_000)).toBe("1h02m");
  });

  it("rewrites one line in place on a terminal", () => {
    const out: string[] = [];
    let clock = 0;
    const r = buildProgressReporter({ isTTY: true, write: (s) => out.push(s) }, () => clock);
    r.update({ id: "t-1", status: "running", synced_count: 0, total_count: 100 });
    clock = 10_000;
    r.update({ id: "t-1", status: "running", synced_count: 50, total_count: 100 });
    r.end();
    expect(out.every((s, i) => (i < 2 ? s.startsWith("\r\x1b[2K") : s === "\n"))).toBe(true);
    // 50 rows in 10s from the first running poll → 50 more take ~10s.
    expect(out[1]).toContain("~10s left");
  });

  it("logs a state change at once, and otherwise at most every 10s", () => {
    const out: string[] = [];
    let clock = 0;
    const r = buildProgressReporter({ isTTY: false, write: (s) => out.push(s) }, () => clock);
    r.update({ id: "t-1", status: "pending" });
    clock = 2_000;
    r.update({ id: "t-1", status: "running", synced_count: 1, total_count: 100 });
    clock = 4_000;
    r.update({ id: "t-1", status: "running", synced_count: 2, total_count: 100 });
    clock = 13_000;
    r.update({ id: "t-1", status: "running", synced_count: 9, total_count: 100 });
    clock = 14_000;
    r.update({ id: "t-1", status: "completed", synced_count: 100, total_count: 100 });
    r.end();
    expect(out.map((l) => l.split(" · ")[0])).toEqual([
      "BuildTask t-1: pending",
      "BuildTask t-1: running",
      "BuildTask t-1: running", // 11s after the last line
      "BuildTask t-1: completed",
    ]);
    expect(out.every((l) => l.endsWith("\n") && !l.includes("\r"))).toBe(true);
  });
});
