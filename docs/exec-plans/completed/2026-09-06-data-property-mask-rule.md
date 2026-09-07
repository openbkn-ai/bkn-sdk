# DataProperty mask-rule implementation plan

Date: 2026-09-06
Status: completed

1. Added and exported the discriminated mask-rule contract and DataProperty type.
2. Added parsing and validation for optional `Mask Rule` JSON cells in object-type `.bkn` files.
3. Made `kn.push` fail locally before network I/O when validation fails.
4. Added focused Vitest coverage for every kind, boundaries, Unicode, invalid JSON, type mismatch, legacy files, and push preflight behavior.
5. Updated the knowledge-network product spec.
6. Verified with `npm run lint`, focused Vitest tests, the full test suite with two workers, and `npm run build`.
