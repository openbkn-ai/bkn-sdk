# Apply a saved semantic-understanding result

The approved cross-repository design is maintained in [bkn-docs](https://github.com/openbkn-ai/bkn-docs/blob/main/docs/foundry/vega/design/issue-218-resource-semantic-understanding-design.md#61-dry-run-结果的后续手动应用), tracked by [Foundry #3119](https://github.com/openbkn-ai/bkn-foundry/issues/3119).

The SDK-specific surface follows the existing API/resource/command layers. Export a typed apply request, expose it through `client.vega`, and require an explicit write mode in the CLI. Server-side state, schema fingerprints, and confidence checks remain authoritative. Global CLI request preview continues to send no requests.
