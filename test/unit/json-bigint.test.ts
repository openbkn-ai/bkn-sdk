import { describe, expect, it } from "vitest";
import { parseBigIntJSON, stringifyBigIntJSON } from "../../src/index.js";

describe("BIGINT JSON helpers", () => {
  it("parses unsafe integers as native bigint and preserves safe integers as number", () => {
    expect(parseBigIntJSON('{"unsafe":110101199001152345,"safe":42}')).toEqual({
      unsafe: 110101199001152345n,
      safe: 42,
    });
  });

  it("serializes native bigint values as JSON number literals", () => {
    expect(stringifyBigIntJSON({ unsafe: 110101199001152345n, safe: 42 })).toBe(
      '{"unsafe":110101199001152345,"safe":42}',
    );
  });
});
