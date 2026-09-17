# admin — operator CLI (nested 1:1)

| Group | Commands |
|-------|----------|
| `org` | `list`/`get <id>`/`members <id>`/`tree`/`create --name …`/`update <id> …`/`delete <id>` (ISFWeb thrift Usrm_*; REST routes are RegisterPrivate). |
| `user` | `list`/`get <id>`/`roles <user>`/`create --login …`/`update <id> …`/`delete <id>`/`assign-role`/`revoke-role`/`reset-password [id] --password …`. |
| `role` | `list [--source]`/`get <role> [--view]`/`members <role>`/`add-member <role> <id> [--type]`/`remove-member`/`grant-perm`/`revoke-perm <role> --resource-type knowledge_network\|catalog\|resource\|tool_box\|function\|mcp\|skill [--resource-id id] --operations a,b`. |
| `llm` / `small-model` | `list/get/add/edit/delete/test` (granular flags or `--body`). `llm list` has no series filter (the server ignores it). |
| `license` | `show`/`import <file.lic>`/`receipt <file.lic>`/`activate`/`remove`/`fingerprint` — cluster license hub on bkn-safe (super-admin). `import` auto-activates online; exit 1 + `stored:true` = stored but issuer refused activation. Offline flow: `fingerprint` → paste at license portal → `receipt <file>`. States: `valid`/`grace`/`fallback_community`/`invalid` (weak judgement, display only). |
| `audit` | `list [--actor-id] [--request-id] [--resource users] [--action create] [--target-id] [--failed-only] [--from RFC3339] [--to RFC3339] [--before-id] [--offset] [--limit ≤500]` → `{logs, total}` / `get <id>`. bkn-safe audit trail of management mutations and 401/403 refusals (not login events); needs `admin-audit:view`. |
| `auth` | Same leaves as top-level `openbkn auth`. |
| `config` / `call` | Active-platform config / operator API passthrough. |

Caller UUID for thrift user writes is resolved from the JWT `sub`, else `GET /api/eacp/v1/user/get`. reset-password RSA-encrypts the new password. Destructive writes act on the live platform — confirm first.
