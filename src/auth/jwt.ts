// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * Minimal JWT payload decoder — base64url decode only, NO signature check.
 * Used to surface identity (sub / username / email) from a stored token.
 * Never trust this for authorization decisions; it is display-only.
 */
export interface JwtClaims {
  sub?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  exp?: number;
  [key: string]: unknown;
}

export function decodeJwt(token: string): JwtClaims | undefined {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return undefined;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json) as JwtClaims;
  } catch {
    return undefined;
  }
}

/** True if the token carries an `exp` in the past. */
export function isExpired(claims: JwtClaims | undefined, nowMs = Date.now()): boolean {
  return claims?.exp !== undefined && claims.exp * 1000 < nowMs;
}

/**
 * When an access token expires, in epoch ms: its own `exp` if it is a JWT,
 * else the `expiresAt` its grant reported. `undefined` means unknown — an
 * opaque token saved before expiry was recorded.
 */
export function tokenExpiresAtMs(accessToken: string, expiresAt?: string): number | undefined {
  const exp = decodeJwt(accessToken)?.exp;
  if (typeof exp === "number") return exp * 1000;
  const at = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  return Number.isNaN(at) ? undefined : at;
}
