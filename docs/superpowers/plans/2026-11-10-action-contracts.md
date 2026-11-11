# Action contracts plan

1. Add typed SDK list filters and existing CLI list options.
2. Pin explicit targets and operation metadata at the request boundary.
3. Run focused regressions, lint, unit tests and build; record remaining live checks.

Local implementation complete: lint, all 1458 unit tests (one optional live
skip), and build passed. Existing SDK/CLI credentials returned 401 against the
current 0.2.2 environment; no live execution or remote mutation was performed.
