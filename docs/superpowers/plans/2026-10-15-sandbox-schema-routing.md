# Sandbox schema fix release backport

Backport main PR #186 to release/0.2.0. Normalize nullable data_properties and
primary_keys, with parser and single-base regression tests. Preserve this branch's
existing three-call schema fetch and legacy metric extraction; do not import
Object Metric V1 (#182) or generated-client changes (#183) as part of this fix.

The companion Context Loader patch supplies authenticated internal GET aliases.
23 baseline verification reproduced route 404 with the existing default URL.
New service deployment and runtime image replacement remain unverified. No tag,
package version, deployment or environment configuration is changed.

Run Python lint/typecheck/tests and npm lint/tests, then the real release Python
client against the companion Go alias router. Record results in the release PR.
Tracking: SDK #185 and Foundry #2188.
