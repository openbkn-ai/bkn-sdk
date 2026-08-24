# Managed lifecycle conversation mode implementation plan

**Goal:** Match the current Foundry start-interaction contract and surface
handshake failures without sending an uncontexted business request.

**Architecture:** Keep the change inside `src/api/lifecycle.ts`. The existing
command/resource/API layering and lifecycle cache behavior remain unchanged.

**Tech stack:** TypeScript, Vitest, mocked `fetch`.

---

1. Update `test/unit/lifecycle.test.ts` so managed-v2 `continue` requires the
   stable `agent_name` alongside the catalog-gated `conversation_mode`.
2. Add a regression test whose start handshake returns `invalid_params`; verify
   the original `ToolError` is raised and no semantic-search request is sent.
3. Run `npm test -- test/unit/lifecycle.test.ts` and confirm the new assertions
   fail against the current implementation.
4. Make the minimal `src/api/lifecycle.ts` change: keep #64's mode detection,
   send the stable Agent name on continue, and remove the handshake-error
   fallback from `bknContextFor`.
5. Re-run the focused test, then `npm run lint`, `npm test`, and `npm run build`.
6. Update `docs/QUALITY_SCORE.md` only if the verified test count changes, then
   review the final diff for scope and secrets.
