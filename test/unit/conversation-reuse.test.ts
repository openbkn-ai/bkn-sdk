import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientFrom, conversationSource, traceOptionsFrom } from "../../src/commands/_shared.js";
import {
  readPlatformConfig,
  setActivePlatform,
  updatePlatformConfig,
  writePlatformConfig,
  writeToken,
} from "../../src/config/store.js";

const saved = { ...process.env };
const platform = "https://demo.example.com";

beforeEach(() => {
  process.env.BKN_CONFIG_DIR = mkdtempSync(join(tmpdir(), "bkn-conv-"));
  for (const k of ["BKN_BASE_URL", "BKN_USER", "BKN_CONVERSATION_ID", "BKN_INTERACTION_ID"]) {
    delete process.env[k];
  }
  writeToken(platform, { baseUrl: platform, accessToken: "t" });
  setActivePlatform(platform);
});
afterEach(() => {
  process.env = { ...saved };
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
    process.env.BKN_CONFIG_DIR = "/proc/definitely-not-writable";
    // Remembering is a convenience; losing it must not fail a command whose
    // real work already succeeded.
    expect(() => client.ctx.onConversationOpened?.("conv-x")).not.toThrow();
  });
});

describe("context conversation --forget", () => {
  it("reports what the next command will use, not a blanket null", () => {
    updatePlatformConfig(platform, { conversationId: "conv-1" });
    process.env.BKN_CONVERSATION_ID = "conv-env";
    // Dropping what was stored does not silence an id still in force; saying
    // `null` here would contradict the very next command.
    expect(conversationSource({})).toEqual({ id: "conv-env", source: "env" });
    expect(readPlatformConfig(platform).conversationId).toBe("conv-1");
  });
});
