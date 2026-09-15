# Function AI generation implementation

- [x] Add typed Function AI generation and prompt-template API requests.
- [x] Expose both operations from `client.functions`.
- [x] Add `function generate` and `function prompt` CLI commands with local validation.
- [x] Add focused API, resource, CLI, and help-contract tests.
- [x] Run lint, build, focused and full unit tests.
- [x] Verify a read-only prompt-template request on 14.103.77.23.
- [x] Move this plan to `completed/` after verification.

The generation endpoint can invoke a model but stores no platform configuration. This change supports only its documented JSON response; `stream: true` remains a raw-call use case until a stream contract is added.
