// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

const UNSAFE_INTEGER = /^-?(?:0|[1-9]\d*)$/;

type JSONParseContext = { source: string };
type JSONParseWithSource = (
  text: string,
  reviver: (this: unknown, key: string, value: unknown, context: JSONParseContext) => unknown,
) => unknown;
type JSONWithRawJSON = typeof JSON & { rawJSON(text: string): unknown };

const parseWithSource = JSON.parse as JSONParseWithSource;
const rawJSON = (JSON as JSONWithRawJSON).rawJSON;

function assertNativeJSONSupport(): void {
  if (typeof rawJSON !== "function") {
    throw new Error(
      "Lossless BIGINT JSON support requires Node.js >=22.19.0 (missing JSON.rawJSON).",
    );
  }

  let source: string | undefined;
  parseWithSource('{"value":1}', (key, value, context) => {
    if (key === "value") source = context?.source;
    return value;
  });
  if (source !== "1") {
    throw new Error(
      "Lossless BIGINT JSON support requires Node.js >=22.19.0 (missing JSON.parse source text access).",
    );
  }
}

assertNativeJSONSupport();

/** An exact JSON decimal. Construct from source text, never an already rounded number. */
export class Decimal {
  readonly #text: string;

  constructor(text: string) {
    if (typeof text !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
      throw new TypeError("Decimal requires a valid JSON number string");
    }
    this.#text = text;
    Object.freeze(this);
  }

  toString(): string {
    return this.#text;
  }

  toJSON(): unknown {
    return rawJSON(this.#text);
  }

  valueOf(): never {
    throw new TypeError("Decimal cannot be implicitly converted to a floating-point number");
  }
}

/** Opt-in exact JSON decoding: fractional/exponent tokens become Decimal, unsafe integers bigint. */
export function parsePreciseJSON(text: string): unknown {
  return parseWithSource(text, (_key, value, context) => {
    if (typeof value !== "number") return value;
    if (!UNSAFE_INTEGER.test(context.source)) return new Decimal(context.source);
    return Number.isSafeInteger(value) ? value : BigInt(context.source);
  });
}

/** Parses JSON integers outside the safe range as native bigint values. */
export function parseBigIntJSON(text: string): unknown {
  return parseWithSource(text, (_key, value, context) => {
    if (
      typeof value !== "number" ||
      !UNSAFE_INTEGER.test(context.source) ||
      Number.isSafeInteger(value)
    ) {
      return value;
    }
    return BigInt(context.source);
  });
}

/** Serializes native bigint values as JSON number literals. */
export function stringifyBigIntJSON(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, item: unknown) => (typeof item === "bigint" ? rawJSON(item.toString()) : item),
    space,
  );
}
