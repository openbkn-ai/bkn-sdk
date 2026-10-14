# Model SDK completion

The requester approved four SDK changes after a source and offline behavior audit:
management-read credential protection, consistent LLM name/id resolution, reliable
stream errors, and documented chat options. Main and release/0.2.0 both need the
verified result. No credentials are rotated, model configuration changed, or
package/runtime floors changed by this work.

Keep existing chat and chatStream signatures; append optional typed options.
Map camelCase options to the published wire fields, including sampling/token
limits, response format, tools/tool choice, stop and cache. Extend OpenAI messages
with structured content and tool-call fields. A stream still returns text; an
optional onChunk callback exposes complete structured chunks, including tool calls.
Add caller cancellation and bounded inference requests, defaulting to 30 seconds.

Move numeric LLM resolution from CLI into the API layer so SDK and CLI share it.
Names require no metadata request; IDs accept bare and data-enveloped get results.
Keep lookup authorization/network errors intact.

Mask adapter_code in management reads rather than guessing which parts of source
code contain secrets. Recursively mask credential-shaped fields in model reads,
while retaining IDs, names, pagination and bigint precision. Both model/admin CLI
surfaces inherit this protection. The output is not a reusable edit payload.
Issue #118's credential rotation remains with its current assignee; do not claim
that client-side masking revokes already exposed credentials.

Parse SSE events across chunk/UTF-8/CRLF boundaries; reject explicit error frames,
malformed data and premature EOF, preserve callback errors, cancel and release
readers, and propagate cancellation/timeouts. Retain the partial text already
emitted to callbacks but reject the promise on failure. Support terminal DONE and
expose structured events without auto-executing tools.

Alternatives: raw call passthrough offers no typed SDK options/error handling;
replacing chat with a new incompatible interface breaks callers. Additive options
and shared boundary handling preserve existing use while fixing verified gaps.

Verification: focused pre-fix regressions, full lint/unit/build checks, CLI describe
and dry-run, and limited name/id + non-stream/stream calls against an existing model
on 23. Never print model definitions or credentials in live evidence. Present a
complete diff before new external submission as required by AGENTS.md.
