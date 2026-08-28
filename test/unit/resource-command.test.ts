import { describe, expect, it } from "vitest";

import { resourceCommand } from "../../src/commands/resource.js";

describe("resourceCommand", () => {
  it("documents enabled-state commands in the command summary", () => {
    const command = resourceCommand();

    expect(command.description()).toContain("enable, disable");
    expect(command.commands.map((child) => child.name())).toEqual(
      expect.arrayContaining(["enable", "disable"]),
    );
  });
});
