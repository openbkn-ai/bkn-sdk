# Row-filter explanation response contract

Fix Foundry issues #2371–#2374 in the shared SDK API parser. User explanations
omit `role_policy_only`; role explanations must return `true`. The existing
required boolean rejects valid user responses before callers can check identity
or revision. Existing SDK and CLI mocks hide this by supplying `false`.

Accept an omitted or false flag for user requests and normalize it to the public
boolean `rolePolicyOnly: false`. Require true for role requests and reject true
for user requests. Keep non-boolean values invalid, with Zod errors pointing to
`role_policy_only`. Select validation from the requested subject rather than
inferring a role request is a user request when its response flag is missing.

Preserve all existing snapshot and policy mappings, public types, request bodies,
and HTTP errors. The resource and CLI share the API implementation; neither needs
separate production logic. No backend, dependencies, or release settings change.

Regression tests cover omitted user flags, explicit false compatibility, role
semantics, invalid types, field preservation, public resource access, CLI JSON,
HTTP denials, and explanation after a rejected optimistic update. Real permission
enforcement and actual query-result consistency require separate live acceptance.
