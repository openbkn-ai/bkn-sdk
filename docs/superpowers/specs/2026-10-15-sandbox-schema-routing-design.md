# Sandbox complete-schema reads

## Problem

Sandbox BKN_BASE_URL points to the authenticated Context Loader listener. OSDK
uses full bkn-backend REST paths that this listener does not register, returning
404 before schema generation. Live reads on 23 also exposed null data_properties
and primary_keys, which the Python parser cannot iterate.

## Final implementation

Keep one BKN_BASE_URL. The companion Context Loader patch authenticates callers
on its existing sandbox listener and forwards only network/object/relation schema
GETs and published Object Metric V1 catalogue pages to its configured internal
backend. Preserve raw fields, bytes, status and verified caller identity; reject
writes, export mode, redirects and oversized responses. No additional URL setting
or network-policy change is introduced.

The Python patch treats null data_properties and primary_keys as empty lists,
matching omitted fields. Preserve the V1 registry and pagination introduced by
#182 and the generated capability client from #183. Tests exercise the new V1
catalogue request through the same base URL, including branch and pagination.

## Limits

Mocked/loopback tests are distinct from deployment validation. The last direct
23 sandbox read still returned the old missing-route 404. A reviewed backend
rollout is required before claiming the default route works live. Customer patch
object-query forwarding is outside this schema fix.
