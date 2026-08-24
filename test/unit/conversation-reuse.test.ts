import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientFrom, conversationSource, traceOptionsFrom } from "../../src/commands/_shared.js";
import { contextCommand } from "../../src/commands/context.js";
import {
  readPlatformConfig,
  setActivePlatform,
  updatePlatformConfig,
  writePlatformConfig,
  writeToken,
} from "../../src/config/store.js";

/** Filled by the `printJson` mock below; one entry per print. */
const printed: unknown[] = [];

vi.mock("../../src/utils/output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/output.js")>()),
  printJson: (value: unknown) => {
    printed.push(value);
  },
}));

const platform = "https://demo.example.com";

beforeEach(() => {
  // An empty store and no ambient `BKN_*` come from `test/setup/isolated-env.ts`
  // — including `BKN_TOKEN`, which `transientIdentity` reads: left set, the
  // feature switches itself off and four assertions here invert.
  writeToken(platform, { baseUrl: platform, accessToken: "t" });
  setActivePlatform(platform);
});

/** A stand-in for the commander object `clientFrom` reads its options from. */
function fakeCmd(opts: Record<string, unknown>) {
  return { optsWithGlobals: () => opts } as unknown as Parameters<typeof clientFrom>[0];
}

describe("remembered conversation", () => {
  it("travels as its own input, not as one the caller named", () => {
    updatePlatformConfig(platform, { conversationId: "conv-1" });
    // A named conversation is taken at its word and its failures are the
    // caller's; a remembered one may be dropped and replaced. Sending the
    // second down the first channel is what made an unusable id permanent.
    expect(traceOptionsFrom({})).toBeUndefined();
    expect(clientFrom(fakeCmd({})).ctx.rememberedConversationId).toBe("conv-1");
  });

  it("never carries an interaction with it", () => {
    updatePlatformConfig(platform, { conversationId: "conv-1" });
    // An interaction is one turn and holds a short lease. Reusing one across
    // commands would both expire and file separate turns as the same one.
    expect(traceOptionsFrom({})?.interactionId).toBeUndefined();
  });

  it("yields to the flag and to the environment", () => {
    updatePlatformConfig(platform, { conversationId: "conv-1" });
    expect(traceOptionsFrom({ conversationId: "conv-flag" })?.conversationId).toBe("conv-flag");
    process.env.BKN_CONVERSATION_ID = "conv-env";
    expect(traceOptionsFrom({})?.conversationId).toBe("conv-env");
    expect(clientFrom(fakeCmd({})).ctx.rememberedConversationId).toBeUndefined();
  });

  it("is skipped for --new-conversation and for a transient identity", () => {
    updatePlatformConfig(platform, { conversationId: "conv-1" });
    for (const o of [
      { newConversation: true },
      // Another identity for one command: the store is keyed by the active
      // user, so its thread is not theirs to join.
      { user: "someone-else" },
      // Identity here is the token, and an explicit one may belong to another
      // tenant entirely while the store still points at the active user.
      { token: "someone-elses-token" },
    ]) {
      expect(conversationSource(o)).toEqual({ source: "none" });
    }
    // And the wiring agrees, not just the resolution.
    expect(
      clientFrom(fakeCmd({ token: "someone-elses-token" })).ctx.rememberedConversationId,
    ).toBeUndefined();
  });

  it("stays absent until something opens one", () => {
    expect(traceOptionsFrom({})).toBeUndefined();
    expect(clientFrom(fakeCmd({})).ctx.rememberedConversationId).toBeUndefined();
  });
});

describe("platform config merge", () => {
  it("keeps the other fields when one is set", () => {
    updatePlatformConfig(platform, { businessDomain: "bd_x" });
    updatePlatformConfig(platform, { conversationId: "conv-1" });
    expect(readPlatformConfig(platform)).toMatchObject({
      businessDomain: "bd_x",
      conversationId: "conv-1",
    });
  });

  it("removes a field set to undefined", () => {
    updatePlatformConfig(platform, { businessDomain: "bd_x", conversationId: "conv-1" });
    updatePlatformConfig(platform, { conversationId: undefined });
    const after = readPlatformConfig(platform);
    expect(after.businessDomain).toBe("bd_x");
    expect(after.conversationId).toBeUndefined();
  });

  it("is the reason `writePlatformConfig` is not used for a single field", () => {
    updatePlatformConfig(platform, { conversationId: "conv-1" });
    // The wholesale writer is still available and still replaces everything —
    // this pins why callers changing one setting must not reach for it.
    writePlatformConfig(platform, { businessDomain: "bd_x" });
    expect(readPlatformConfig(platform).conversationId).toBeUndefined();
  });
});

describe("conversationSource", () => {
  it("names the layer in force, including the ones that suppress the stored id", () => {
    updatePlatformConfig(platform, { conversationId: "conv-1" });
    expect(conversationSource({})).toEqual({ id: "conv-1", source: "stored" });
    expect(conversationSource({ conversationId: "c" })).toEqual({ id: "c", source: "flag" });
    // `--new-conversation` and a transient identity both mean "none" — the
    // reporting command must say so rather than showing an id that will not
    // be used.
    expect(conversationSource({ newConversation: true })).toEqual({ source: "none" });
    expect(conversationSource({ user: "someone" })).toEqual({ source: "none" });
  });
});

describe("remembering a conversation the run opened", () => {
  it("writes it under the platform the request went to", () => {
    const client = clientFrom(fakeCmd({}));
    client.ctx.onConversationOpened?.("conv-new");
    expect(readPlatformConfig(platform)).toMatchObject({ conversationId: "conv-new" });
    expect(readPlatformConfig(platform).conversationOpenedAt).toEqual(expect.any(String));
  });

  it("is not wired up at all for a transient identity", () => {
    writeToken(platform, { baseUrl: platform, accessToken: "t2", username: "other" });
    // Read and write agree: a transient identity neither joins the stored
    // thread nor replaces it.
    expect(clientFrom(fakeCmd({ user: "other" })).ctx.onConversationOpened).toBeUndefined();
    expect(clientFrom(fakeCmd({ token: "raw" })).ctx.onConversationOpened).toBeUndefined();
  });

  it("is not wired up under --new-conversation either", () => {
    updatePlatformConfig(platform, { conversationId: "conv-1" });
    // The flag declines to use the remembered thread for one command; ending it
    // for every later one would be a different, unadvertised thing.
    expect(clientFrom(fakeCmd({ newConversation: true })).ctx.onConversationOpened).toBeUndefined();
    expect(readPlatformConfig(platform).conversationId).toBe("conv-1");
  });

  it("survives a store it cannot write", () => {
    const client = clientFrom(fakeCmd({}));
    // A regular file where a directory has to go: `mkdir` fails with ENOTDIR on
    // every platform, immediately. The earlier `/proc/...` path only failed
    // that way on Linux, and left this test asserting a different thing
    // depending on who ran it.
    const blocked = join(mkdtempSync(join(tmpdir(), "bkn-blocked-")), "not-a-dir");
    writeFileSync(blocked, "");
    process.env.BKN_CONFIG_DIR = blocked;
    // Remembering is a convenience; losing it must not fail a command whose
    // real work already succeeded.
    expect(() => client.ctx.onConversationOpened?.("conv-x")).not.toThrow();
  });
});

/**
 * The command itself, not the resolver underneath it.
 *
 * The payload is taken from `printJson`, never from `process.stdout`. Two
 * earlier versions replaced `process.stdout.write` and this file then hung
 * every CI run to the job's six-hour limit — 48 of 49 files reported, this one
 * never did. A worker's stdout belongs to the runner as much as to the test,
 * and neither swallowing chunks nor throwing on the ones that are not JSON
 * showed up locally, where the reporter had nothing to say in that window.
 * Mocking the module the command prints through leaves that plumbing alone.
 */
function run(...argv: string[]): unknown {
  printed.length = 0;
  new Command("openbkn")
    .exitOverride()
    .option("--json")
    .option("--conversation-id <id>")
    .addCommand(contextCommand())
    .parse(["node", "openbkn", "--json", ...argv]);
  return printed[0];
}

describe("openbkn context conversation", () => {
  it("reports the layer in force and what is on disk behind it", () => {
    updatePlatformConfig(platform, { conversationId: "conv-1" });
    expect(run("context", "conversation")).toMatchObject({
      conversationId: "conv-1",
      source: "stored",
    });
    expect(run("--conversation-id", "conv-flag", "context", "conversation")).toMatchObject({
      conversationId: "conv-flag",
      source: "flag",
      storedConversationId: "conv-1",
    });
  });

  it("--forget names what it dropped and still reports what comes next", () => {
    updatePlatformConfig(platform, { conversationId: "conv-1" });
    // With an id still in force the rest of this payload matches a plain read,
    // so without `forgot` the command would look like it did nothing.
    const out = run("--conversation-id", "conv-flag", "context", "conversation", "--forget");
    expect(out).toMatchObject({ forgot: "conv-1", conversationId: "conv-flag", source: "flag" });
    expect(readPlatformConfig(platform).conversationId).toBeUndefined();
    // And it says so rather than claiming null, which the next command would
    // contradict.
    const after = run("context", "conversation");
    expect(after).toMatchObject({ conversationId: null, source: "none" });
    // A plain read never claims to have forgotten anything.
    expect(after).not.toHaveProperty("forgot");
  });
});
