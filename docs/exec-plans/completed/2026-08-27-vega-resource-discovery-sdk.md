# Vega Resource Discovery SDK Plan

1. Update discovery and resource API schemas plus request mapping for the new
   endpoints and fields. Completed.
2. Expose the operations from resource and Vega SDK namespaces without breaking
   command-to-resource-to-API layering. Completed.
3. Add CLI commands and filters, keeping queue priority display-only. Completed.
4. Update Vega product/reference documentation and focused API/CLI regression
   tests. Completed.
5. Run lint, unit tests, and a diff check; move this plan to `completed/` after
   successful verification. Completed: `npm run lint`, `npm test`, and
   `git diff --check` pass.
