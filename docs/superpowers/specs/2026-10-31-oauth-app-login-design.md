# Signing users in to an app

An app that calls the platform as its user needs an OAuth token for that user and
has to keep it alive. Today the SDKs only refresh the session `openbkn auth login`
stored in `~/.bkn`; an app that gets a token any other way hand-writes PKCE, a
callback server, the code exchange and the refresh grant (Studio's App development
page shows ~90 lines of it per language). This adds those flows to both SDKs, with
the same names and behavior, and lets an app's own tokens refresh the way a stored
session already does.

No platform change. Everything used exists on the platform today:
`/oauth2/auth`, `/oauth2/token`, `/oauth2/device/auth` (Hydra, every release) and
`/api/safe/v1/oauth/register` (bkn-safe self-registration: public clients only,
`authorization_code` + `refresh_token`, scope `openid offline offline_access`,
loopback redirects on any port unless an operator allows more; absent on 0.2.0 and
wherever registration is disabled).

## API

Both languages expose the same six functions. Python: `bkn_osdk.oauth`,
snake_case, keyword-only options. TypeScript: `import { oauth } from
"@openbkn/bkn-sdk"`, camelCase, an options object.

| Function | Does |
| --- | --- |
| `register_client(base_url, client_name, redirect_uris=[DEFAULT_REDIRECT_URI])` | Self-register a public client; returns `client_id`, `client_name`, `redirect_uris`. A 404/405 means the platform has no self-registration: raise saying so and pointing at device login. |
| `authorization_request(base_url, client_id, redirect_uri=DEFAULT_REDIRECT_URI, scope="openid offline")` | Fresh PKCE verifier (S256) and state; returns `url`, `state`, `code_verifier`, `client_id`, `redirect_uri`. Pure, no I/O. For web apps whose own server receives the callback. |
| `exchange_code(base_url, request, code, state)` | Check `state` against the request, then the `authorization_code` grant with the verifier. Returns tokens. |
| `login(base_url, client_id, redirect_uri=DEFAULT_REDIRECT_URI, scope, open_browser=True, on_url=None, timeout=300s)` | The whole loopback flow: listen on the redirect's host and port **before** opening the browser (a user with a live session is redirected back at once), open it (or only call `on_url` when `open_browser` is false or the machine is headless), wait for the one request on the redirect path, answer it with a short "you can close this page" text, check state and `error`, exchange. Other paths get 404 and keep the wait going. Refuses a non-loopback or non-http redirect with a message pointing at `authorization_request` + `exchange_code`. `on_url` defaults to printing the URL to stderr. |
| `device_login(base_url, client_id="openbkn-sdk", scope, on_prompt=None, timeout=None)` | RFC 8628: request a code, hand `user_code`, `verification_uri`, `verification_uri_complete` (re-hosted on `base_url`, as the CLI already does) to `on_prompt` (default: print to stderr), poll honoring `interval`, `slow_down` (+5 s), `access_denied`, `expired_token`. TypeScript already has this in `src/auth/oauth.ts`; export it. |
| `refresh(base_url, tokens, client_id)` | The `refresh_token` grant. Returns the new tokens; when the response carries no new refresh token, the old one is kept in the result. |

Every function takes `insecure` (skip TLS verification, as elsewhere) and the HTTP
ones a timeout. `DEFAULT_REDIRECT_URI = "http://127.0.0.1:8765/callback"`, the
value Studio registers by default.

Tokens: Python `oauth.Tokens(access_token, refresh_token=None, id_token=None,
expires_at=None)` (frozen dataclass, `expires_at` ISO 8601 UTC from `expires_in`),
with `to_dict()` / `Tokens.from_dict()` for storage. TypeScript reuses the existing
`RefreshableTokens` / `OAuthTokens` shape (`accessToken`, `refreshToken`, `idToken`,
`expiresAt`).

Errors: a sign-in that did not happen (user denied, state mismatch, timeout,
expired device code, `invalid_grant`, no self-registration) raises Python
`AuthError(BknError)` with `error` and `description` attributes, exported from
`bkn_osdk` and `bkn_osdk.errors`; TypeScript throws `InputError` for those, as
`deviceLogin` does today. The platform's `error_description` is carried in the
message. Tokens never appear in messages.

## Using the tokens

Python: `configure(...)` and `session(...)` take `tokens`, `client_id` and
`on_refresh`:

```python
tokens = oauth.login(PLATFORM, client_id=CLIENT_ID)
bkn_osdk.configure(base_url=PLATFORM, tokens=tokens, client_id=CLIENT_ID, on_refresh=save)
```

TypeScript: `createClient` takes `tokens`, `clientId` and `onTokenRefresh`:

```ts
const tokens = await oauth.login(PLATFORM, { clientId: CLIENT_ID });
const bkn = createClient({ baseUrl: PLATFORM, tokens, clientId: CLIENT_ID, onTokenRefresh: save });
```

Passing both `token` and `tokens` is an `InputError`. `client_id` defaults to
`openbkn-sdk`, which is right for device-login tokens; tokens from `login` need the
app's own id, since the refresh grant must name the client that was issued them.

Refresh then behaves exactly like a stored session's, with the app's callback in
place of the write to `~/.bkn`:

- shortly before `expires_at` (60 s) and on a 401 (then retry once);
- one refresh in flight per configured token set, so concurrent requests in a
  process share it (Python: a lock on the holder created by each
  `configure`/`session` call; TypeScript: the existing per-context single flight);
- the callback receives the full new token set, refresh token included, after
  every successful refresh. In TypeScript an exception from it fails the refresh,
  as `persist` already does; in Python it propagates to the request.
- a failed refresh surfaces the original 401 with a hint to sign the user in
  again, not to run `openbkn auth login`.

A `session(tokens=...)` per request is how a multi-user Python server keeps each
user's tokens apart; the context variable already isolates threads and tasks.

## Documented caveats

README sections in both languages ("Sign users in to your app") state:

1. Save the refresh token from every callback. Each refresh spends the old one; an
   app that keeps only the first must sign the user in again on its next start.
2. Do not refresh one user's token set from two processes. The platform treats a
   reused refresh token as theft and revokes the whole chain, signing the user out
   everywhere. One process is safe (single flight); several instances need a
   shared store with a lock, or one place that refreshes.
3. A failed refresh means sign in again: the token expired, was revoked, or the
   user disconnected the app under connected clients.
4. `login` serves loopback callbacks only (CLIs, desktop apps, scripts, notebooks).
   A web app uses `authorization_request` + `exchange_code` from its own handler,
   and a non-loopback callback needs an operator to allow its origin.

## Not changed

The CLI and its store, `createAuthenticatedClient`, the stored-session refresh
path, the platform, and dependencies (Python stays on `httpx` plus the standard
library; TypeScript on Node built-ins).

## Tests

Offline, with the token endpoint faked:

- PKCE against RFC 7636 appendix B (`dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`
  → `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`); authorization URL parameters;
- `login` end to end, the "browser" being an `on_url` that requests the callback;
  plus a stray path first (404, still waiting), state mismatch, `error=access_denied`,
  timeout, non-loopback redirect refused, server listening before `on_url` runs;
- `exchange_code` state check and `invalid_grant`;
- `device_login` pending → slow_down → success, denied, expired;
- `refresh` rotation and keep-old-refresh-token;
- `register_client` request body, success, 404 → no-registration error;
- client with `tokens`: proactive refresh near expiry, 401 → refresh → retry,
  callback called once with the rotated token under concurrent requests, failure →
  original 401 with the sign-in-again hint, `token` + `tokens` refused.

Live: device-login start and a registered client's authorize URL accepted by the
dev deployment; a full browser sign-in needs a person and is done by hand once.
