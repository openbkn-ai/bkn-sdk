# Server version check implementation plan

1. Add version-check state to the request context and a focused compatibility
   module that reads `/api/bkn-backend/v1/health`, normalizes SemVer, and reports actionable
   failures.
2. Add a per-platform 60-second CLI cache to the existing local config store;
   construct CLI clients in that mode while library clients stay memory-only.
3. Gate shared typed requests and raw calls before their business request while
   preserving version-endpoint recursion exemption and dry-run zero-network behavior.
4. Add unit tests for matching, prerelease normalization, mismatch blocking,
   missing version failure, one-check client cache, CLI TTL cache, and dry run.
5. Run formatting, focused tests, lint, and the full unit suite; move this plan
   to `completed/` only after verification.
