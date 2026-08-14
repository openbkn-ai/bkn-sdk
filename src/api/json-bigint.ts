// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import JSONBig from "json-bigint";

const bigintJSON = JSONBig({ useNativeBigInt: true });

/** Parses JSON integers outside the safe range as native bigint values. */
export function parseBigIntJSON(text: string): unknown {
  return bigintJSON.parse(text);
}

/** Serializes native bigint values as JSON number literals. */
export function stringifyBigIntJSON(value: unknown, space?: number): string {
  return bigintJSON.stringify(value, null, space);
}
