# SDK account-password client plan

1. Add public account-authentication and token-refresh callback types.
2. Add `createAuthenticatedClient()` while preserving `createClient()`.
3. Reuse the credential device-login flow with in-memory token refresh.
4. Add mocked login, refresh, and invalid-credential unit coverage.
5. Update the README and verify lint, tests, build, and POC reads.
