import { describe, expect, it } from "vitest";
import { collectDep, parseJsonOption, readCode } from "../../src/commands/function.js";
import { InputError } from "../../src/utils/errors.js";

describe("--dep", () => {
  it("accumulates across repeats and keeps the version off the name", () => {
    const first = collectDep("requests@2.32.3");
    expect(collectDep("numpy", first)).toEqual([
      { name: "requests", version: "2.32.3" },
      { name: "numpy" },
    ]);
  });

  it("splits on the last @, so a name containing one survives", () => {
    expect(collectDep("@scope/pkg@1.0.0")).toEqual([{ name: "@scope/pkg", version: "1.0.0" }]);
  });

  it("refuses an empty value rather than sending a nameless dependency", () => {
    expect(() => collectDep("")).toThrow(InputError);
  });
});

describe("JSON options", () => {
  it("passes undefined through, so an unset flag stays unset", () => {
    expect(parseJsonOption(undefined, "event")).toBeUndefined();
  });

  it("names the flag it could not parse", () => {
    expect(() => parseJsonOption("{oops", "event")).toThrow(/--event must be valid JSON/);
  });
});

describe("reading code", () => {
  it("says which file it could not read instead of a bare ENOENT", () => {
    expect(() => readCode("/nope/missing.py")).toThrow(/Cannot read \/nope\/missing.py/);
  });
});
