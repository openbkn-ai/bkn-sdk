# Complete OSDK schema generation

The 23 sandbox returns object-type list summaries without data properties and
with null primary keys. The prior nullable fix prevents a crash but generates
classes with no properties. Public detail reads return the full caller-visible
schema. Use those details, with the same credential, branch and encoded type ID,
for summary entries only. Preserve already-complete list entries and reject
missing/mismatched detail responses instead of silently generating partial code.
Do not alter SDK base URL resolution or public REST path assembly.

Hydration reveals mounted metric IDs which are platform UUIDs starting with
digits. Prefix that metric class name with `Metric` while retaining its exact
wire ID. Existing class names, object-type naming rules and branch-specific
metric protocols remain unchanged. Main targets Object Metric V1; release/0.2.0
keeps its mounted legacy metrics. No version floor or npm engine change.

Regression tests cover direct/list/entries detail envelopes, encoded IDs,
branch/auth forwarding, missing details and UUID metric generation. Run both
Python suites, lint and type checks. Live verification must exercise generated
properties, primary-key reads, filters, paging, traversal, metrics and lifecycle
paths with the candidate source identified separately from the installed image.

Live traversal also exposed lost seed context: `RelationPath.of` fell back to
ambient configuration even when its input row carried the explicit gateway and
caller context. Match one-hop traversal: explicit argument > seed-bound context
> ambient context. Preserve this context on decoded results, and test both URL
and Authorization so a traversal never silently switches platform or caller.
