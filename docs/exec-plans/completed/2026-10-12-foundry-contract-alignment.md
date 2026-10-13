# Foundry contract alignment plan

Design: [2026-10-12-foundry-contract-alignment-design.md](../../superpowers/specs/2026-10-12-foundry-contract-alignment-design.md)

1. Add focused Metric validation and optional object-property regressions; update
   the Vega 404 regression to describe the published contract.
2. Parse and export Metric validation results, set the CLI failure exit code, and
   correct the Vega contract documentation and hint.
3. Update product specifications, README files, Skill references, and the quality
   scorecard. Verify lint, unit
   tests, build, and CLI self-description; report remaining coverage limits.
4. Move this plan to completed and present the working-tree diff for review.

## Verification

- `npm run lint`: passed (Biome and TypeScript).
- Focused Vitest run across Metric, Vega, BKN, query, and push coverage: 251 passed.
- `npm test` after rebasing onto current `main`: 1256 passed, one optional live LLM-judge test skipped.
- `npm run build`: passed, including public declaration generation.
- `node dist/cli.js describe bkn metric validate --json` and
  `node dist/cli.js describe vega index-capabilities --json`: updated descriptions,
  argument source, and existing command sections confirmed.
- CLI Metric validation `--dry-run`: canonical POST preview with redacted
  Authorization; request not sent.
- Existing null-list normalization and omitted `data_properties` query/push tests
  remain green. SDK omission coverage added without changing existing parsers.

The local x64 Node runtime needed matching Rollup, esbuild, and Biome binaries;
the installed versions were unpacked into ignored `node_modules` only. Package
manifests, lockfiles, and the Node floor were unchanged. No live backend validation
or package publication was performed. Commit, push, and PR creation were authorized
by the requester after reviewing the changes.
