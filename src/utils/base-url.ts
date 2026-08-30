// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/** One spelling of "drop the trailing slashes", used wherever a base URL is stored or compared. */

/**
 * Strip trailing `/` from a base URL.
 *
 * Written as a scan rather than `replace(/\/+$/, "")` because that pattern is
 * quadratic on a string of many slashes — the engine retries the `+` from every
 * position — which CodeQL flags as a polynomial ReDoS on a value that arrives
 * from a flag, an environment variable, or a config file. A base URL is not
 * hostile input in practice; the scan costs nothing and removes the question,
 * and having one copy means the answer does not have to be re-litigated at each
 * of the seven places that trimmed the same way.
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}
