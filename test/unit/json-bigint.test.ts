import { describe, expect, it } from "vitest";
import { parseBigIntJSON, stringifyBigIntJSON } from "../../src/index.js";

describe("BIGINT JSON helpers", () => {
  it("parses only integers outside the safe range as native bigint", () => {
    expect(
      parseBigIntJSON(
        '{"max_safe":9007199254740991,"min_safe":-9007199254740991,"unsafe":9007199254740993,"negative_unsafe":-9007199254740992}',
      ),
    ).toEqual({
      max_safe: 9007199254740991,
      min_safe: -9007199254740991,
      unsafe: 9007199254740993n,
      negative_unsafe: -9007199254740992n,
    });
  });

  it("keeps fractional and exponent numbers as number", () => {
    expect(parseBigIntJSON('{"fraction":0.30000000000000004,"exponent":1.5e300}')).toEqual({
      fraction: 0.30000000000000004,
      exponent: 1.5e300,
    });
  });

  it("preserves JSON string values that look like integers", () => {
    expect(parseBigIntJSON('{"id":"110101199001152345"}')).toEqual({
      id: "110101199001152345",
    });
  });

  it("keeps keys that native JSON.parse accepts", () => {
    const parsed = parseBigIntJSON('{"constructor":1,"__proto__":2}') as Record<string, unknown>;

    expect(parsed.constructor).toBe(1);
    expect(Object.getOwnPropertyDescriptor(parsed, "__proto__")?.value).toBe(2);
  });

  it("serializes native bigint values as JSON number literals", () => {
    expect(stringifyBigIntJSON({ unsafe: 110101199001152345n, safe: 42 })).toBe(
      '{"unsafe":110101199001152345,"safe":42}',
    );
  });
});
