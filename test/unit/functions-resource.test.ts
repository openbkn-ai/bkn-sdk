import { afterEach, describe, expect, it, vi } from "vitest";
import { functions } from "../../src/resources/functions.js";
import type { RequestContext } from "../../src/types.js";
import { InputError } from "../../src/utils/errors.js";
import { verifiedContext } from "../setup/verified-context.js";

const ctx = verifiedContext<RequestContext>({
  baseUrl: "https://demo.example.com",
  token: "t",
  insecure: false,
});

afterEach(() => vi.unstubAllGlobals());

describe("Function AI generation resource", () => {
  it("rejects SSE instead of pretending a stream is JSON", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(() =>
      functions(ctx).generate("python_function_generator", {
        query: "write a handler",
        stream: true,
      }),
    ).toThrow(InputError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a non-positive or fractional timeout before sending", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const timeoutMs of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        functions(ctx).generate("python_function_generator", { query: "q" }, { timeoutMs }),
      ).toThrow(/timeoutMs must be a positive integer/);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires the input specific to the generation direction", () => {
    expect(() =>
      functions(ctx).generate("metadata_param_generator", { query: "not code" }),
    ).toThrow(/requires non-empty code/);
  });
});
