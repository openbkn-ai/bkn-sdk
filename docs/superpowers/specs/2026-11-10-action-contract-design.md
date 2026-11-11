# Action contract support for Foundry #3059

The new action service requires explicit operation metadata and execution targets.
Existing schema writes, action discovery and action execution already forward their
JSON envelopes, including precise numeric literals, so they need contract tests
rather than a second action model in the SDK. Extend action list options with
`operationKind` and `relationOperation`, serialized before server pagination, and
expose the same filters on the existing CLI list command. Do not change transport,
authentication, Node support, dependencies, or add old-model inference.

Validation: focused wire tests for metadata, relation/object targets, precise IDs,
and filters; existing lint, unit tests, and build. Real deployment remains a
separate integration check tracked in openbkn-ai/bkn-foundry#3059.
