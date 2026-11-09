# Quality evaluation (Professional and above)

The resource is `client.evals`. It requires a deployment with Eval enabled and
Professional-or-higher entitlement. It does not implement an autonomous participant runner.
Trace's `evalSetBuild` prepares trace fixtures and is a separate feature.

## Management

Use `client.evals.forNetwork(knId).request(operation, input, options)` with an
operation from `EVAL_OPERATIONS`. Pass exact backend JSON field names in `body`,
route identifiers in `path` and filters in `query`. All identifiers are encoded.
`options.signal` cancels the request; `options.timeoutMs` overrides the timeout.
Lists are paged by the server; there is no implicit read-all or write retry.

Weekly schedules use Monday=1 through Sunday=7. Monthly days beyond the end
of a month execute on its last day.

The 48 operations cover overview/scope, Cases and assets, Suite versions,
rule configuration/application, trial/preflight,
Run creation/cancellation/search, frozen definitions and results, revisions,
historical/agent comparison and schedules. Dynamic management
responses are `unknown`, not claimed to be fully typed business schemas. Error
responses use the SDK's shared `HttpError` contract. Integer observations preserve
precision. Successful 204 deletes return `undefined`. Argument validation failures
reject the returned Promise, so `.catch()` and `Promise.allSettled()` work
consistently across management and participant methods. The two plan OAuth operations
(`beginEvalRunPlanAuthorization` and `completeEvalRunPlanAuthorization`) belong
to the Studio browser authorization flow and are outside this catalogue.

All Eval business calls require a valid human user who is the network creator
(with network view permission) or holds all network permissions: `view_detail`,
`modify`, `delete`, `query_data`, `authorize`, and `execute`. A single management
or execution permission is insufficient. Downstream resource permissions still
apply. Reading gold also requires a successful audit write. A user able to read
gold is not a blinded participant; keep management calls outside the answer loop.

## External participants

The same existing knowledge-network MCP advertises five `bkn_eval_*` tools when
the provider is enabled. Interactive agents can call those discovered tools using
the existing MCP CLI. Node applications can use the authenticated provider adapter:

```ts
const participant = bkn.evals.participant;
const suites = await participant.listSuites(knId, { page: 1, limit: 20 });
const suite = suites.entries[0];
if (!suite) throw new Error("No published suite is available.");
const started = await participant.startRun(knId, {
  suite_id: suite.suite_id,
  version: suite.version,
  agent: { name: "My agent", model: "self-reported-model" },
  idempotency_key: crypto.randomUUID(),
});
const credentials = { run_id: started.run_id, run_token: started.run_token };
const task = await participant.nextCase(knId, credentials);
if (!task.done) {
  // Give question and bkn_context to your agent. Use that exact context for tools.
  const result = await myAgent.answer(task.question, task.bkn_context);
  await participant.submitResult(knId, {
    ...credentials,
    case_run_id: task.case_run_id,
    task_token: task.task_token,
    answer: result.text,
    structured_output: result.businessFields,
  });
}
const progress = await participant.getProgress(knId, credentials);
```

Continue claiming/submitting until `done`. Preserve the start idempotency key
across transport retries. Preserve identical submission content across retries,
including `EVAL_EVIDENCE_PENDING` while Trace assembles. The SDK does not retry a
write automatically or invent a new identity. Leases expire after 30 minutes;
reclaimed tasks invalidate their earlier task token. Never log run/task tokens.
The participant must not end the platform-owned Interaction itself.

Only supported, explicitly granted read-only Function Cases can be externally
executed, at most 50 per Run. Both answer text and structured business output are
required; deterministic grading uses the structured output and independently
verified Trace. Participant response validation preserves additional backend fields
for forward compatibility; request validation remains strict. Brand/model are self-reported. No token consumption is estimated.
The data baseline is a label, not a frozen business-data snapshot. Compare completed
Runs of a shared Suite/version via `compareEvalAgentRuns`; the server reports any
contract/data mismatch rather than asserting every Run is comparable.

## Sources and verification

Backend contracts: `openapi.yaml`, `openapi-management.yaml`,
`openapi-external.yaml` in EE bkn-backend `eval/docs/openapi/`.
The backend route regression validates every mounted route against these files.
SDK protocol and transport regressions live in `test/unit/evals.test.ts`.
Real MCP execution and database initialization require a configured integration
environment and are not part of mocked unit tests.

SDK/platform preflight requires matching patch versions. Eval uses the existing
SDK compatibility, authentication, timeout, and transport policies. This feature
does not publish a package or change the version policy; use a released SDK that
matches the target platform.
