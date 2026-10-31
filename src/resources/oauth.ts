// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * `oauth` — sign users in to your own app and keep their tokens alive.
 *
 *   import { oauth, createClient } from "@openbkn/bkn-sdk";
 *   const tokens = await oauth.login(baseUrl, { clientId });
 *   const bkn = createClient({ baseUrl, tokens, clientId, onTokenRefresh: save });
 *
 * Unlike `auth`, nothing here reads or writes the `~/.bkn` store.
 */
export {
  DEFAULT_REDIRECT_URI,
  authorizationRequest,
  exchangeCode,
  login,
  refresh,
  registerClient,
  type AuthorizationRequest,
  type AuthorizationRequestOptions,
  type ExchangeCodeOptions,
  type LoginOptions,
  type RefreshOptions,
  type RegisterClientOptions,
  type RegisteredClient,
} from "../auth/oauth-app.js";
export {
  deviceLogin,
  type DeviceLoginOptions,
  type DevicePrompt,
  type OAuthTokens,
} from "../auth/oauth.js";
