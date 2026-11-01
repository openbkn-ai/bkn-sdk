# Plan: signing users in to an app

Spec: [2026-10-31-oauth-app-login-design.md](../specs/2026-10-31-oauth-app-login-design.md).
The two languages are independent and can be built in parallel; they share only
the spec.

## Python (`python/`)

1. `bkn_osdk/oauth.py`: `Tokens`, `RegisteredClient`, `AuthorizationRequest`,
   `DEFAULT_REDIRECT_URI`, and the six functions. Standard library for PKCE, the
   loopback server (`http.server`, one request per `handle_request`, socket timeout
   for the deadline) and the browser (`webbrowser`); `httpx` for HTTP.
2. `errors.py`: `AuthError(BknError)` with `error` and `description`; export from
   `bkn_osdk`.
3. `config.py`: `tokens`, `client_id`, `on_refresh` on `configure` and `session`;
   a mutable, locked token holder created per call and carried on `Context`;
   `token` + `tokens` refused.
4. `auth.py` / `http.py`: `token_for` and `refreshed_token` serve the holder as well
   as the stored credential (proactive near `expires_at`, 401 retry, single flight,
   callback after rotation); the 401 hint for a failed app refresh says to sign the
   user in again.
5. Tests in `tests/test_oauth.py` and `tests/test_auth.py`; `ruff`, `mypy --strict`,
   `pytest`.
6. `README.md` and `README.zh.md`: "Sign users in to your app", with the four caveats.

## TypeScript (`src/`, `test/`)

1. `src/auth/oauth.ts`: `registerClient`, `authorizationRequest`, `exchangeCode`,
   `login` (loopback `node:http` server), `refresh`; keep `deviceLogin` and
   `refreshAccessToken` as they are.
2. `src/resources/oauth.ts` re-exports the public six and `DEFAULT_REDIRECT_URI`;
   `src/index.ts` exports `oauth`.
3. `ClientOptions`: `tokens`, `clientId`, `onTokenRefresh`; `resolveContext` builds
   `ctx.refresh` from them; `token` + `tokens` refused; the 401 hints for app tokens
   say to sign the user in again.
4. Tests in `test/unit/oauth-app-login.test.ts` and next to the client tests;
   `npm run lint`, `npm test`.
5. `README.md`: "Sign users in to your app", with the four caveats.

## Verify

Both suites green; live checks against the dev deployment listed in the spec; one
manual browser sign-in with each language.
