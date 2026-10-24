# Object metric contract alignment plan

1. Add public TypeScript types for Object Metric V1 query, filter, result, and drill-through contracts.
2. Type existing trial/query methods and add missing canonical Object Metric V1 endpoint wrappers.
3. Expose the wrappers through the knowledge-network resource and package exports.
4. Correct Python OSDK query serialization to `group_by`, retain a compatibility alias, and expose current query choices.
5. Update SDK documentation and focused contract tests.
6. Run TypeScript and Python verification and record any remaining contract gaps.
