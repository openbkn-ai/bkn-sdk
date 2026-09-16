import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../../src/cli-run.js";
import { writeVersionCheckCache } from "../../src/config/store.js";

const ARGS = [
  "node",
  "openbkn",
  "--base-url",
  "https://demo.example.com",
  "--token",
  "t",
  "--json",
  "vega",
  "resource",
  "build",
  "r-1",
];

beforeEach(() => {
  writeVersionCheckCache("https://demo.example.com", {
    serverVersion: "0.1.5",
    checkedAt: new Date().toISOString(),
  });
});

afterEach(() => {
  process.exitCode = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runCli", () => {
  it("prints a Vega HTTP 400, sets a failure exit code, and returns for graceful shutdown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "VegaBackend.BuildTask.InvalidParameter.UnsupportedSchemaFields",
            }),
            {
              status: 400,
              statusText: "Bad Request",
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runCli(ARGS)).resolves.toBeUndefined();

    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("VegaBackend.BuildTask.InvalidParameter.UnsupportedSchemaFields"),
    );
  });
});
