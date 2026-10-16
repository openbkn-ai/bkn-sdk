# OSDK capability verification on 23

## Implementation

- [x] Reproduce summary-only object catalogues returning no generated properties.
- [x] Hydrate public details with caller credentials and branch; fail on incomplete details.
- [x] Generate legal class names for metric UUIDs beginning with digits, preserving wire IDs.
- [x] Preserve seed-bound context for multi-hop reads; explicit context still wins.
- [x] Add focused regressions and run main/release Python, lint/type and Node suites.

## Live acceptance

- [x] Run real sandbox OSDK calls against the discovered internal gateway.
- [x] Verify 15 object types, 224 properties and 15 primary-key declarations.
- [x] Verify code generation/import, stable fingerprint, decoding, filters,
  sorting/selection, cursor/offset paging, iteration, primary-key hit/miss,
  raw queries, one/two-hop relations, metric queries and tool discovery.
- [ ] Verify managed schema search, instance search, Context Loader REST helper
  and traced read after the paired Retrieval/Observability lifecycle fix is deployed.
  Current 23 returns capture_disabled without conversation/interaction IDs.
- [ ] Rebuild/re-pin the sandbox to the reviewed, merged SDK fix and validate fresh
  default executors. Candidate code was loaded for individual verification calls;
  the running image and its default gateway environment were not replaced.

## Evidence and limitations

Candidate checks: 25 passed. Four managed-lifecycle checks are blocked by the
current server combination. One deliberately included installed-SDK baseline
check fails because the installed version still generates zero properties.
The two-hop MRP path returned two rows; some other network paths independently
return server 400 and are not treated as a passing data-quality result.
Validation returns counts/status only, without caller tokens or business rows.
No business action or Skill with unknown side effects was executed.
