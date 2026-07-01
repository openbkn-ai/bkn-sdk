// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the OpenBKN License. See the LICENSE file in the project root.

/**
 * AppKey API (`/api/safe/v1/{me,admin}/api-keys`, OAuth-token-gated). AppKeys
 * are user-issued long-lived credentials (prefix `bak_`) that authenticate AS
 * their owner — downstream authorization is identical to that owner's OAuth
 * token. Issuing/managing them needs a real OAuth session (an AppKey itself
 * cannot mint AppKeys). The plaintext `key` is returned ONCE, on create.
 * Usage of an AppKey is drop-in: pass it as the bearer `--token` against the
 * Context Loader (agent-retrieval) MCP/REST surface. See issue #75.
 */
import type { RequestContext } from "../types.js";
import { request } from "./http.js";

const ME = "/api/safe/v1/me/api-keys";
const ADMIN = "/api/safe/v1/admin/api-keys";

/** A key's public metadata — never carries the secret. */
export interface ApiKey {
  id: string;
  key_id: string;
  name: string;
  /** Masked preview for display, e.g. `bak_b3ff****b234` — safe to show in lists. */
  masked: string;
  enabled: boolean;
  /** `null` = never expires. */
  expires_at: string | null;
  /** `null` = never used (zombie-key signal). */
  last_used_at: string | null;
  created_at: string;
  /** Present only on the admin list. */
  owner_user_id?: string;
}

/** Create response — `key` is the full plaintext, shown only this once. */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

export interface CreateApiKeyInput {
  name: string;
  /** RFC3339; omit = backend default (1 year). Must be in the future. */
  expiresAt?: string;
  /** `true` = never expire (wins over `expiresAt`). */
  neverExpire?: boolean;
}

// ── self-service (the owner manages their own keys) ──────────────────────────

/** GET /me/api-keys — list the caller's own keys (no secrets). */
export function listMyApiKeys(ctx: RequestContext): Promise<{ keys: ApiKey[] }> {
  return request(ctx, ME);
}

/** POST /me/api-keys — issue a key. The 201 response carries the plaintext once. */
export function createMyApiKey(
  ctx: RequestContext,
  input: CreateApiKeyInput,
): Promise<CreatedApiKey> {
  return request(ctx, ME, {
    method: "POST",
    body: {
      name: input.name,
      ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
      ...(input.neverExpire ? { never_expire: true } : {}),
    },
  });
}

/** DELETE /me/api-keys/:id — revoke (immediate; 404 if not the caller's). */
export async function revokeMyApiKey(ctx: RequestContext, id: string): Promise<void> {
  await request(ctx, `${ME}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * POST /me/api-keys/:id/regenerate — rotate in place: invalidate the old secret
 * and mint a new one under the SAME record `id`. Returns the new plaintext `key`
 * (shown only this once); the old `bak_…` stops working immediately.
 */
export function regenerateMyApiKey(ctx: RequestContext, id: string): Promise<CreatedApiKey> {
  return request(ctx, `${ME}/${encodeURIComponent(id)}/regenerate`, { method: "POST" });
}

// ── admin (governance / incident response) ───────────────────────────────────

/** GET /admin/api-keys?owner_id= — list all keys (or one owner's); adds owner_user_id. */
export function listApiKeysAdmin(
  ctx: RequestContext,
  ownerId?: string,
): Promise<{ keys: ApiKey[] }> {
  return request(ctx, ADMIN, { query: { owner_id: ownerId || undefined } });
}

/** DELETE /admin/api-keys/:id — revoke any key. */
export async function revokeApiKeyAdmin(ctx: RequestContext, id: string): Promise<void> {
  await request(ctx, `${ADMIN}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
