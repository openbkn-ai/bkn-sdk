# Empty Metric validation compatibility plan

Design: [2026-10-13-metric-validation-empty-design.md](../../superpowers/specs/2026-10-13-metric-validation-empty-design.md)

1. Reproduce the empty-response error with focused SDK and CLI regressions.
2. Normalize the successful empty response at the Metric API boundary and update guidance.
3. Run lint, unit tests, build, and real existing-Metric validation on 23.
4. Record evidence and submit a follow-up PR linked to #172.

## Verification

- Before the fix, both empty HTTP 200/204 regressions failed with ZodError.
- `npm run lint`: passed.
- `npm test`: 1260 passed; one optional live LLM-judge test skipped.
- `npm run build`: passed, including declarations.
- Live existing Metric on `http://14.103.77.23`: fetched `m_order_cnt` (order count)
  from `ecommerce_ops_bkn_zh_attrs_import`, copied its creation fields under a
  unique name of fewer than 40 characters, and called validation only.
- SDK returned `{valid: true}` and CLI exited 0. A nonexistent scope returned
  HTTP 400 with the dependency detail; CLI exited 1. Metric IDs and count (15)
  were unchanged before and after. No definition was persisted.

Reproduction:

```bash
BKN_BASE_URL=http://14.103.77.23 \
BKN_KN_ID=ecommerce_ops_bkn_zh_attrs_import \
BKN_METRIC_ID=m_order_cnt BKN_SKIP_VERSION_CHECK=1 \
node test/e2e/metric-validation.mjs
```

The live probe uses stored credentials and never prints tokens. Version checking
was explicitly skipped as authorized. Modern JSON `valid:false` remains covered
by unit tests; this deployment reports dependency errors as HTTP 400. Empty 204
compatibility is unit-tested, since this target returns 200.
