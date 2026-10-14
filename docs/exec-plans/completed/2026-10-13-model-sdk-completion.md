# Model SDK completion plan

Design: [2026-10-13-model-sdk-completion-design.md](../../superpowers/specs/2026-10-13-model-sdk-completion-design.md)

1. Add failing SDK/CLI regressions using synthetic credentials and model responses.
2. Protect management reads and share LLM name/id resolution across SDK/CLI.
3. Add typed chat options/messages, structured stream events, cancellation and SSE errors.
4. Update exports, CLI/README/Skill guidance, and coverage records.
5. Verify lint, full unit tests, build, and existing-model calls on 23; record limits.
6. Present the diff for review, then propagate approved changes to main/release PRs.

## Verification

- Six focused regressions failed before implementation: response protection,
  SDK name/id resolution (JSON and stream), options, SSE errors, callback errors.
- `npm run lint`: passed. `npm test`: 1292 passed, one optional live LLM judge skipped.
- `npm run build`: passed, including public declarations.
- The same patch applies cleanly to release/0.2.0. Its isolated candidate
  passed lint/typecheck, 55 focused model regressions, and build/declarations.
- CLI describe/help expose --options and --options-file. Chat --dry-run previews
  mapped fields and redacted authorization without sending a request.
- `test/e2e/model-sdk.mjs` passed on 23 using existing `qwen3.8-max`
  (`2088207719654887424`): SDK name+options, SDK ID+stream+options (13 chunks),
  CLI ID+options, small-model detail adapter masking, and model tool-call options.
  The model returned sdk_probe; no tool was executed. No model registry or
  configuration was changed. Version checking was explicitly skipped as authorized.
- Forced toolChoice object returned HTTP 400 because this model uses thinking
  mode; auto mode returned the expected tool call. Capability support remains
  provider-dependent and the SDK preserves those errors.

Reproduction (stored authentication; no credential output):

```bash
BKN_BASE_URL=http://14.103.77.23 \
BKN_LLM_ID=2088207719654887424 \
BKN_SMALL_MODEL_ID=2085574230874918912 \
BKN_MODEL_TOOLS=1 BKN_SKIP_VERSION_CHECK=1 \
node test/e2e/model-sdk.mjs
```

Coverage limits: cancellation, premature EOF, error frames, and tool-call stream
chunks are mocked; this target's normal stream/name/id/tool request paths were
live-tested. The generic Skill validator rejects the existing argument-hint
frontmatter; it was preserved, while repository Skill tests pass. #118 credential
rotation/revocation is not performed or claimed by this local SDK change.

The requester approved the reviewed working-tree diff and explicitly authorized
commit, push, and PR submission for main and release/0.2.0 on 2026-10-14.
Human review/merge remains required. No deployment or package publication is
performed by this change.

## PR review follow-up (2026-10-14)

Release PR #179 identified a compatibility regression in empty SSE data events.
The same parser is present in main PR #178, so both receive the correction.

- Four empty/whitespace keep-alive regressions and two message-extension regressions
  failed before the fix. Empty data events are now ignored; explicit error events
  still fail. Provider-returned message fields are preserved rather than rejected.
- Role validation remains user/assistant/system/tool, matching the Foundry backend;
  unsupported roles were never accepted by that backend.
- `npm run lint`, `npm test` (1299 passed, one optional live judge skipped), and
  `npm run build` passed. Empty named error events retain negative coverage.
- Existing five-check 23 verification remains applicable to normal model invocation.
  Empty keep-alive injection and message metadata preservation were tested offline,
  not claimed as fault injection into the live deployment.
