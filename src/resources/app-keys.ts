// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

import {
  type CreateApiKeyInput,
  createMyApiKey,
  listApiKeysAdmin,
  listMyApiKeys,
  regenerateMyApiKey,
  revokeApiKeyAdmin,
  revokeMyApiKey,
} from "../api/app-keys.js";
/**
 * AppKey resource surface — the SDK API for issuing/managing user AppKeys.
 * Pure typed functions over `api/app-keys`; knows nothing about argv/stdout.
 * Note: these MANAGE keys (OAuth session required). To USE an AppKey, just pass
 * it as the bearer token (`createClient({ token: "bak_…" })`) — no code here.
 */
import type { RequestContext } from "../types.js";

export function appKeys(ctx: RequestContext) {
  return {
    /** List the caller's own keys (no secrets). */
    list: () => listMyApiKeys(ctx),
    /** Issue a key — the result's `key` is the plaintext, shown only once. */
    create: (input: CreateApiKeyInput) => createMyApiKey(ctx, input),
    /** Revoke one of the caller's keys (immediate). */
    revoke: (id: string) => revokeMyApiKey(ctx, id),
    /** Rotate a key in place — new plaintext (shown once); old secret dies now. */
    regenerate: (id: string) => regenerateMyApiKey(ctx, id),

    /** Admin: list all keys, or one owner's (adds `owner_user_id`). */
    adminList: (ownerId?: string) => listApiKeysAdmin(ctx, ownerId),
    /** Admin: revoke any key. */
    adminRevoke: (id: string) => revokeApiKeyAdmin(ctx, id),
  };
}
