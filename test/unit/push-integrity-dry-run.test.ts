import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, expect, it, vi } from "vitest";
import { bknCommand } from "../../src/commands/bkn.js";
import { DryRunSignal, enableDryRun } from "../../src/utils/dry-run.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

it("previews the push upload without reading object types or sending a request", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bkn-push-dry-run-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "network.bkn"),
    "---\ntype: knowledge_network\nid: kn1\nname: Test Network\n---\n",
  );
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  enableDryRun();
  const cli = new Command("openbkn")
    .exitOverride()
    .option("--base-url <url>")
    .option("--token <token>");
  cli.addCommand(bknCommand());

  let signal: unknown;
  try {
    await cli.parseAsync(
      [
        "--base-url",
        "https://push-dry-run.example.com",
        "--token",
        "secret",
        "bkn",
        "push",
        dir,
        "--branch",
        "release",
      ],
      { from: "user" },
    );
  } catch (error) {
    signal = error;
  }

  expect(signal).toBeInstanceOf(DryRunSignal);
  expect((signal as DryRunSignal).request).toMatchObject({
    dryRun: true,
    method: "POST",
    url: "https://push-dry-run.example.com/api/bkn-backend/v1/bkns?branch=release",
    body: "<binary or multipart>",
    headers: { authorization: "<redacted>" },
  });
  expect(fetch).not.toHaveBeenCalled();
});
