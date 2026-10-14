// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import { parseBigIntJSON } from "../utils/json-bigint.js";

// Adapter source can embed arbitrary secrets; masking field names inside source is not sufficient.
const SECRET =
  /^(adapter[_-]?code|x[_-]?api[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|secret[_-]?key|client[_-]?secret|credential(s)?|private[_-]?key|secret[_-]?access[_-]?key|authorization|proxy[_-]?authorization|cookie|set[_-]?cookie)$/i;
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      SECRET.test(key) ? "<redacted>" : redact(field),
    ]),
  );
}

/** Management metadata stays lossless, while code and credentials never reach SDK/CLI callers. */
export function parseModelResponse(text: string): unknown {
  return redact(parseBigIntJSON(text));
}
