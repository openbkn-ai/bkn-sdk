# SDK account-password client design

## Intent

Expose the SDK's existing headless account-password OAuth flow as a supported
programmatic API. A Node.js service must authenticate without a prior CLI login
or a session stored in `~/.bkn`.

## Current state

`credentialDeviceLogin()` already obtains a refreshable OAuth session through
the platform device-code flow. It is used by `openbkn auth login -u/-p`, but the
library entry only exposes synchronous `createClient()`.

## Chosen API

Add an asynchronous factory without changing the existing synchronous API:

```ts
const client = await createAuthenticatedClient({
  baseUrl,
  auth: { username, password },
  onTokenRefresh: (tokens) => saveTokens(tokens),
});
```

The factory does not persist credentials to `~/.bkn`; a service owns optional
persistence through the callback. The returned client has an in-memory refresh
configuration and reuses the existing one-refresh-and-retry path.

## Alternatives rejected

- Making `createClient()` asynchronous would break existing SDK callers.
- Requiring CLI login couples a service to a user home directory.
- A password grant is unavailable for the seeded public OAuth client; the
  implementation reuses its credential-driven device-code flow.

## Security

- Passwords and tokens are never logged or written to disk by default.
- A future service-client OAuth grant can add a separate factory without
  changing this API.
