# Managed object metric parity plan

1. Add strict Python OSDK regressions for unmanaged and managed metric queries,
   including receipts, parent operations, branches, and every public runtime
   choice.
2. Route managed `Metric.query` through MCP and normalize its result to the
   direct Object Metric V1 envelope.
3. Add optional metric branch propagation through Context Loader interfaces,
   logic, ontology-query adapter, REST/MCP schemas, and focused tests.
4. Complete TypeScript generic Context Loader defaults for metric drill-through.
5. Recapture the Context Loader Python contract, regenerate `kn.py` and sandbox
   capability stubs, and update schema identity fixtures.
6. Extend the sandbox OSDK build check with installed metric module provenance;
   leave the immutable pin update for the post-review SDK commit.
7. Make live business-provenance definition resolution branch-aware while
   retaining signed projection semantics.
8. Migrate SDK/foundry Skill templates off the retired metric shape, update
   product/quality documentation, and run TypeScript, Python, Go, OpenAPI,
   generator, and sandbox verification.
9. Address review findings: carry branch through network, object type, metric,
   and permission discovery; keep generated Sandbox metric tool positionals
   stable; emit REST metric evidence; reject an installed pre-fix OSDK at image
   build time.
10. After the SDK diff is approved and committed, update the Sandbox OSDK pin to
    that immutable commit and build the image. Until then the build check must
    reject the old pin.
