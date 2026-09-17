// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * A progress line for a BuildTask being waited on, so a `--wait` that takes
 * minutes shows it is moving — and how far it has to go — instead of sitting
 * silent until it ends.
 *
 * On a terminal the line rewrites itself in place. Anywhere else (a CI log, a
 * file) each line is permanent, so one is written when the state changes and
 * otherwise at most every {@link LOG_EVERY_MS}.
 */
import type { BuildTask } from "../api/vega.js";

export interface ProgressSink {
  isTTY?: boolean;
  write(chunk: string): unknown;
}

const LOG_EVERY_MS = 10_000;

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

/** One line: state, rows synced of total, time spent, and time left at the rate seen so far. */
export function describeBuildProgress(task: BuildTask, elapsedMs: number, etaMs?: number): string {
  const state = task.status ?? "unknown";
  const parts = [`BuildTask ${task.id}: ${state}`];
  const total = task.total_count;
  const synced = task.synced_count;
  if (typeof synced === "number" && typeof total === "number" && total > 0) {
    const pct = Math.min(100, Math.floor((synced / total) * 100));
    parts.push(`${synced.toLocaleString("en-US")}/${total.toLocaleString("en-US")} rows (${pct}%)`);
  } else if (typeof synced === "number") {
    parts.push(`${synced.toLocaleString("en-US")} rows`);
  }
  parts.push(`${formatDuration(elapsedMs)} elapsed`);
  if (etaMs !== undefined) parts.push(`~${formatDuration(etaMs)} left`);
  return parts.join(" · ");
}

export function buildProgressReporter(
  out: ProgressSink = process.stderr,
  now: () => number = Date.now,
): { update(task: BuildTask): void; end(): void } {
  const start = now();
  let baseline: { at: number; synced: number } | undefined;
  let lastState: string | undefined;
  let lastLine = "";
  let lastLoggedAt = Number.NEGATIVE_INFINITY;
  let open = false;

  const eta = (task: BuildTask, at: number): number | undefined => {
    const synced = task.synced_count;
    const total = task.total_count;
    if (typeof synced !== "number" || typeof total !== "number" || total <= 0) return undefined;
    // Time left means nothing once the task is not running.
    if (task.status !== "running") return undefined;
    // Measure the rate from the first poll that saw the task running, not from
    // the start: time spent pending would make a fast build look slow.
    if (!baseline) {
      baseline = { at, synced };
      return undefined;
    }
    const rate = (synced - baseline.synced) / (at - baseline.at);
    return rate > 0 ? Math.max(0, (total - synced) / rate) : undefined;
  };

  return {
    update(task) {
      const at = now();
      const state = task.status ?? "";
      const line = describeBuildProgress(task, at - start, eta(task, at));
      if (out.isTTY) {
        out.write(`\r\x1b[2K${line}`);
        open = true;
      } else if (state !== lastState || (line !== lastLine && at - lastLoggedAt >= LOG_EVERY_MS)) {
        out.write(`${line}\n`);
        lastLoggedAt = at;
      }
      lastState = state;
      lastLine = line;
    },
    end() {
      if (open) out.write("\n");
      open = false;
    },
  };
}
