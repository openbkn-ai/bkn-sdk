// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };

const skills = vi.hoisted(() => ({
  republish: vi.fn(async () => ({ status: "editing" })),
  publishHistory: vi.fn(async () => ({ status: "published" })),
}));
vi.mock("../../src/client.js", () => ({ createClient: vi.fn(() => ({ skills })) }));
import { buildProgram } from "../../src/cli-program.js";

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const GLOBAL = ["--json", "--base-url", "https://skill.example", "--token", "test"];

describe("skill history versions in the real CLI tree", () => {
  it.each([
    ["publish-history", skills.publishHistory],
    ["republish", skills.republish],
  ] as const)(
    "%s sends --skill-version instead of printing the SDK version",
    async (name, method) => {
      await buildProgram().parseAsync(
        [...GLOBAL, "skill", name, "s1", "--skill-version", "v-old"],
        { from: "user" },
      );
      expect(method).toHaveBeenCalledWith("s1", "v-old");
      expect(process.stdout.write).not.toHaveBeenCalledWith(`${pkg.version}\n`);
    },
  );

  it.each(["publish-history", "republish"])("%s no longer declares --version", (name) => {
    const skill = buildProgram().commands.find((c) => c.name() === "skill");
    const sub = skill?.commands.find((c) => c.name() === name);
    expect(sub?.options.map((o) => o.long)).toEqual(["--skill-version"]);
  });
});
