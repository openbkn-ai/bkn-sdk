import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The declared Node floor and the floor CI actually runs must be the same
 * number.
 *
 * They drifted once and it shipped: 0.1.4 declared `>=24.19.0` while nothing
 * proved a caller on that version was better off than one below it. npm does
 * not error on an unsatisfiable `engines` — it resolves past the version and
 * installs the previous release — so every user below the floor silently got
 * 0.1.3 and the release looked, from the outside, like it had never happened.
 *
 * A floor is a claim about what the code needs. This keeps the claim tied to
 * the one job that tests it.
 */
describe("the declared Node floor", () => {
  const root = new URL("../../", import.meta.url).pathname;
  const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8")) as {
    engines?: { node?: string };
  };
  const ci = readFileSync(`${root}.github/workflows/ci.yml`, "utf8");

  it("is an exact `>=x.y.z`, not a range CI cannot pin", () => {
    expect(pkg.engines?.node).toMatch(/^>=\d+\.\d+\.\d+$/);
  });

  it("is the version the engines-floor job runs", () => {
    const floor = pkg.engines?.node?.replace(">=", "") ?? "";
    // The job exists to run the suite on the lowest supported runtime; read the
    // version out of it rather than trusting that someone updated both.
    const job = ci.slice(ci.indexOf("engines-floor:"));
    const pinned = /node-version:\s*(\d+\.\d+\.\d+)/.exec(job)?.[1];
    expect(pinned).toBe(floor);
  });

  it("is not above the running Node when the suite passes here", () => {
    // Whatever runs this file satisfies the floor by definition — otherwise the
    // floor is claiming more than anything has demonstrated.
    const rank = (v: string) => {
      const [maj = 0, min = 0, patch = 0] = v.split(".").map(Number);
      return maj * 1e6 + min * 1e3 + patch;
    };
    const declared = rank(pkg.engines?.node?.replace(">=", "") ?? "0.0.0");
    const running = rank(process.versions.node);
    expect(running).toBeGreaterThanOrEqual(declared);
  });
});
