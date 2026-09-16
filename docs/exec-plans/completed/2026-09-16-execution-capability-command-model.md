# Execution capability command model

## Objective

Separate temporary sandbox code from registered Function and OpenAPI Tools while retaining the generic Toolbox/Tool surface for compatibility.

## Steps

- [x] Move temporary Function sandbox CLI operations to `sandbox`.
- [x] Add `function` and `api` typed facades over the existing Toolbox/Tool client.
- [x] Update help, describe metadata, product documentation, and skill references.
- [x] Add focused regression coverage for typed create/import requests and command ownership.
- [ ] Run build, full unit tests, live read-only validation on 14.103.77.23, and review the diff.
