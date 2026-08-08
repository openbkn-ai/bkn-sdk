import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { vegaCommand } from "../../src/commands/vega.js";

function cli(): Command {
  const root = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <t>");
  root.addCommand(vegaCommand());
  return root;
}

afterEach(() => vi.unstubAllGlobals());

describe("vega dataset build-list", () => {
  it("rejects the removed default ordering before issuing a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      cli().parseAsync(
        [
          "--base-url",
          "https://demo.example.com",
          "--token",
          "t",
          "vega",
          "dataset",
          "build-list",
          "--order-by",
          "default",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow(/--order-by default is no longer supported/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
