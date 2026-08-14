// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { randomUUID } from "node:crypto";
import JSONBig from "json-bigint";

const bigintJSON = JSONBig({ useNativeBigInt: true });
const UNSAFE_INTEGER = /^-?(?:0|[1-9]\d*)$/;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Parses JSON integers outside the safe range as native bigint values. */
export function parseBigIntJSON(text: string): unknown {
  const tokens = new Map<string, string>();
  const protectedText = protectUnsafeIntegers(text, tokens);

  return JSON.parse(protectedText, (_key, value: unknown) => {
    if (typeof value !== "string") return value;
    const token = tokens.get(value);
    return token === undefined ? value : BigInt(token);
  });
}

/** Serializes native bigint values as JSON number literals. */
export function stringifyBigIntJSON(value: unknown, space?: number): string {
  return bigintJSON.stringify(value, null, space);
}

function protectUnsafeIntegers(text: string, tokens: Map<string, string>): string {
  let protectedText = "";
  let inString = false;
  let escaped = false;
  const placeholderPrefix = `\u0000openbkn-bigint:${randomUUID()}:`;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (inString) {
      protectedText += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      protectedText += char;
      continue;
    }

    if (char === "-" || (char >= "0" && char <= "9")) {
      NUMBER.lastIndex = index;
      const match = NUMBER.exec(text);
      if (match) {
        const token = match[0];
        index += token.length - 1;
        if (UNSAFE_INTEGER.test(token) && !Number.isSafeInteger(Number(token))) {
          const placeholder = `${placeholderPrefix}${tokens.size}`;
          tokens.set(placeholder, token);
          protectedText += JSON.stringify(placeholder);
        } else {
          protectedText += token;
        }
        continue;
      }
    }

    protectedText += char;
  }

  return protectedText;
}
