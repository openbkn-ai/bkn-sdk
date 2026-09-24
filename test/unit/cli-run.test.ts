import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };

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
    serverVersion: pkg.version,
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

  /* A platform this SDK release can never match, on a host the cache has no entry for. */
  const MISMATCHED = ARGS.map((arg) =>
    arg === "https://demo.example.com" ? "https://skip.example.com" : arg,
  );

  function routeMismatch() {
    return vi.fn(async (input: string | URL) => {
      const path = new URL(String(input)).pathname;
      const body =
        path === "/api/bkn-backend/v1/health" ? { ServerVersion: "0.1.4" } : { id: "task-1" };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  }

  const pathsOf = (fetch: ReturnType<typeof routeMismatch>) =>
    fetch.mock.calls.map((call) => new URL(String(call[0])).pathname);

  it("blocks a mismatched platform when the flag is absent", async () => {
    const fetch = routeMismatch();
    vi.stubGlobal("fetch", fetch);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runCli(MISMATCHED)).resolves.toBeUndefined();

    expect(pathsOf(fetch)).toEqual(["/api/bkn-backend/v1/health"]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("platform version 0.1.4"));
  });

  it("reads --skip-version-check before commander parses, so the request is sent anyway", async () => {
    // The switch is process-wide: import a throwaway module graph so flipping it
    // here cannot leak into the tests above.
    vi.resetModules();
    const { runCli: freshRunCli } = await import("../../src/cli-run.js");
    const fetch = routeMismatch();
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(freshRunCli([...MISMATCHED, "--skip-version-check"])).resolves.toBeUndefined();

    expect(pathsOf(fetch)).not.toContain("/api/bkn-backend/v1/health");
    expect(pathsOf(fetch)).not.toHaveLength(0);
  });
});
