import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { operatorCommand } from "../../src/commands/operator.js";

function cli(): Command {
  const root = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <t>");
  root.addCommand(operatorCommand());
  return root;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function suppressOutput(): void {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

/** The operator this deploy already holds, as `operator/info/{id}` answers. */
const EXISTING = {
  name: "add",
  metadata: { description: "adds two numbers" },
  operator_info: {
    category: "data_analysis",
    operator_type: "basic",
    execution_mode: "sync",
    is_data_source: false,
  },
  operator_execute_control: { timeout: 5000 },
};

function codeFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "openbkn-op-"));
  const file = join(dir, "add.py");
  writeFileSync(file, "def handler(event):\n    return {}\n");
  return file;
}

describe("operator update", () => {
  it("carries forward the settings the caller did not name", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init: RequestInit) => {
        calls.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(JSON.stringify(init?.method === "POST" ? {} : EXISTING), {
          status: 200,
        });
      }),
    );
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "operator",
        "update",
        "op-1",
        codeFile(),
      ],
      { from: "user" },
    );

    // The endpoint replaces the whole package, so anything this body omits comes
    // back as a server default — that is how an update of the code alone moved a
    // `data_analysis` operator into `other_category`.
    const sent = calls.find((c) => c.url.includes("/operator/info/update"))?.body as Record<
      string,
      // biome-ignore lint/suspicious/noExplicitAny: assertion on a free-form body
      any
    >;
    expect(sent.operator_id).toBe("op-1");
    expect(sent.operator_info.category).toBe("data_analysis");
    expect(sent.operator_info.operator_type).toBe("basic");
    expect(sent.operator_execute_control.timeout).toBe(5000);
    expect(sent.function_input.name).toBe("add");
    expect(sent.description).toBe("adds two numbers");
  });

  it("lets a named flag win over what is stored", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init: RequestInit) => {
        calls.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(JSON.stringify(init?.method === "POST" ? {} : EXISTING), {
          status: 200,
        });
      }),
    );
    suppressOutput();

    await cli().parseAsync(
      [
        "--base-url",
        "https://demo.example.com",
        "--token",
        "t",
        "operator",
        "update",
        "op-1",
        codeFile(),
        "--category",
        "data_query",
      ],
      { from: "user" },
    );

    // biome-ignore lint/suspicious/noExplicitAny: assertion on a free-form body
    const sent = calls.find((c) => c.url.includes("/operator/info/update"))?.body as any;
    expect(sent.operator_info.category).toBe("data_query");
  });
});
