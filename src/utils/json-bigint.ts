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
