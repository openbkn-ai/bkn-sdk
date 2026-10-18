// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };

const metric = vi.hoisted(() => ({
  objectMetricPublish: vi.fn(async () => ({ published: true })),
  objectMetricQuery: vi.fn(async () => ({ entries: [{ value: 30 }] })),
  objectMetricGet: vi.fn(async () => ({ definition: { version: 2 } })),
}));
vi.mock("../../src/client.js", () => ({ createClient: vi.fn(() => ({ kn: metric })) }));
import { buildProgram } from "../../src/cli-program.js";

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("metric versions in the real CLI tree", () => {
  it.each([false, true])("keeps global options after the command: %s", async (after) => {
    const global = ["--json", "--base-url", "https://metric.example", "--token", "test"];
    const command = ["bkn", "object-metric", "publish", "kn", "metric", "--metric-version", "2"];
    await buildProgram().parseAsync(after ? [...command, ...global] : [...global, ...command], {
      from: "user",
    });
    expect(metric.objectMetricPublish).toHaveBeenCalledWith(
      "kn",
      "metric",
      expect.objectContaining({ version: 2 }),
    );
    expect(process.stdout.write).not.toHaveBeenCalledWith(`${pkg.version}\n`);
  });

  it("forwards a pinned query version and an optional read version", async () => {
    await buildProgram().parseAsync(
      [
        "--json",
        "bkn",
        "object-metric",
        "query",
        "kn",
        "metric",
        "--metric-version",
        "3",
        "--body",
        "{}",
      ],
      { from: "user" },
    );
    expect(metric.objectMetricQuery).toHaveBeenCalledWith(
      "kn",
      "metric",
      {},
      expect.objectContaining({ version: 3 }),
    );
    await buildProgram().parseAsync(
      ["bkn", "object-metric", "get", "kn", "metric", "--metric-version", "2", "--json"],
      { from: "user" },
    );
    expect(metric.objectMetricGet).toHaveBeenCalledWith(
      "kn",
      "metric",
      expect.objectContaining({ version: 2 }),
    );
  });

  it.each(["--version", "-V"])("preserves the root SDK version flag %s", async (flag) => {
    await expect(
      buildProgram().exitOverride().parseAsync([flag], { from: "user" }),
    ).rejects.toMatchObject({
      code: "commander.version",
      exitCode: 0,
    });
    expect(process.stdout.write).toHaveBeenCalledWith(`${pkg.version}\n`);
    expect(metric.objectMetricPublish).not.toHaveBeenCalled();
  });
});
