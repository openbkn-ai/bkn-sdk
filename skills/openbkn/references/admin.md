# admin — operator CLI (nested 1:1)

| Group | Commands |
|-------|----------|
| `org` | `list`/`get <id>`/`members <id>`/`tree`/`create --name …`/`update <id> …`/`delete <id>` (ISFWeb thrift Usrm_*; REST routes are RegisterPrivate). |
| `user` | `list`/`get <id>`/`roles <user>`/`create --login …`/`update <id> …`/`delete <id>`/`assign-role`/`revoke-role`/`reset-password [id] --password …`. |
| `role` | `list [--source]`/`get <role> [--view]`/`members <role>`/`add-member <role> <id> [--type]`/`remove-member`. |
| `llm` / `small-model` | `list/get/add/edit/delete/test` (granular flags or `--body`). |
| `audit list` | EACP login-log (may be unreachable if the eacp upstream is cluster-internal). |
| `auth` | Same leaves as top-level `openbkn auth`. |
| `config` / `call` | Active-platform config / operator API passthrough. |

Caller UUID for thrift user writes is resolved from the JWT `sub`, else `GET /api/eacp/v1/user/get`. reset-password RSA-encrypts the new password. Destructive writes act on the live platform — confirm first.
