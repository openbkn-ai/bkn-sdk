# admin — operator CLI (nested 1:1)

All org/user/role/audit/license commands call bkn-safe's `/api/safe/v1/admin/*` REST API with the caller's OAuth token; the account must hold the matching admin permission (403 otherwise).

| Group | Commands |
|-------|----------|
| `org` | `list [--name] [--offset] [--limit]`/`get <id>`/`members <id> [--offset] [--limit]`/`tree`/`create --name … [--parent id] [--manager id] [--code] [--email] [--remark]`/`update <id> …`/`delete <id>` (bkn-safe `/admin/departments`; `tree` reads every page). |
| `user` | `list [--keyword] [--org dept-id] [--offset] [--limit]`/`get <id>`/`roles <user>`/`create --login … (--password s \| --prompt-password \| env BKN_NEW_USER_PASSWORD) [--display-name] [--email] [--tel] [--department id…]`/`update <id> [--display-name] [--email] [--tel] [--department id…]`/`delete <id>`/`assign-role`/`revoke-role`/`reset-password [id] --password …` (bkn-safe `/admin/users`). `create` has no default password: it refuses without one. |
| `role` | `list [--source]`/`get <role> [--view]`/`members <role> [--offset] [--limit]`/`add-member <role> <id> [--type] [--member type:id…]`/`remove-member`/`grant-perm`/`revoke-perm <role> --resource-type knowledge_network\|catalog\|resource\|tool_box\|function\|mcp\|skill [--resource-id id] --operations a,b` (bkn-safe `/admin/roles`, `/admin/role-bindings`). |
| `llm` / `small-model` | `list [--name] [--type] [--page] [--size]`/`get/add/edit/delete/test` (granular flags or `--body`; mf-model-manager). `llm list` has no series filter (the server ignores it). |
| `license` | `show`/`import <file.lic>`/`receipt <file.lic>`/`activate`/`remove`/`fingerprint` — cluster license hub on bkn-safe (super-admin). `import` auto-activates online; exit 1 + `stored:true` = stored but issuer refused activation. Offline flow: `fingerprint` → paste at license portal → `receipt <file>`. States: `valid`/`grace`/`fallback_community`/`invalid` (weak judgement, display only). |
| `audit` | `list [--actor-id] [--request-id] [--resource users] [--action create] [--target-id] [--failed-only] [--from RFC3339] [--to RFC3339] [--before-id] [--offset] [--limit ≤500]` → `{logs, total}` / `get <id>`. bkn-safe audit trail of management mutations and 401/403 refusals (not login events); needs `admin-audit:view`. |
| `auth` | Same leaves as top-level `openbkn auth`. |
| `config` / `call` | Active-platform config / operator API passthrough. |

Passwords go to bkn-safe as plaintext over TLS; `reset-password` without `--password` resets to the platform initial password and forces a change on next login. Destructive writes act on the live platform — confirm first.
