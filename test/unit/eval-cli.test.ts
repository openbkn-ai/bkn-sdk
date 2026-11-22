import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../../src/cli-program.js";
import { runCli } from "../../src/cli-run.js";

const inputs = [
  "--base-url",
  "https://eval.example.test",
  "--token",
  "test-token",
  "--json",
  "eval",
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Eval CLI", () => {
  it.each([
    ["preview-rules", "/rule-applications/preview"],
    ["save-rules", "/rule-applications/save"],
    ["create-suite", "/suites"],
    ["preview-run", "/runs/multi/preview"],
    ["start-run", "/runs/multi"],
  ])("maps %s to %s without changing the request body", async (name, path) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const body = { scope: { kind: "suite", suite_id: "suite-1", version: 1 } };
    await runCli([
      "node",
      "openbkn",
      "--dry-run",
      ...inputs,
      name,
      "kn/a",
      "--body",
      JSON.stringify(body),
    ]);
    const requests = output.mock.calls.map(([chunk]) => JSON.parse(String(chunk)));
    expect(requests).toEqual([
      expect.objectContaining({
        method: "POST",
        url: `https://eval.example.test/api/bkn-backend/v1/knowledge-networks/kn%2Fa/evals${path}`,
        body,
      }),
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps resource filters and run cursors as query parameters", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runCli([
      "node",
      "openbkn",
      "--dry-run",
      ...inputs,
      "resources",
      "kn",
      "--kind",
      "metric",
      "--offset",
      "0",
      "--limit",
      "15",
    ]);
    await runCli([
      "node",
      "openbkn",
      "--dry-run",
      ...inputs,
      "run-cases",
      "kn",
      "run/a",
      "--cursor",
      "next&one",
    ]);
    const urls = output.mock.calls.map(([chunk]) => new URL(JSON.parse(String(chunk)).url));
    expect(urls[0]?.pathname).toMatch(/\/evals\/case-resources$/);
    expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
      kind: "metric",
      offset: "0",
      limit: "15",
    });
    expect(urls[1]?.pathname).toMatch(/\/evals\/runs\/run%2Fa\/cases$/);
    expect(urls[1]?.searchParams.get("cursor")).toBe("next&one");
  });

  it.each([
    [["--body", "[]"], "JSON object"],
    [["--body", "{}", "--body-file", "ignored.json"], "cannot be combined"],
  ])("rejects invalid body arguments before any request", async (args, message) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      buildProgram().parseAsync([...inputs, "save-rules", "kn", ...args], { from: "user" }),
    ).rejects.toThrow(message);
    expect(fetch).not.toHaveBeenCalled();
  });
});
