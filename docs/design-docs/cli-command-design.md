# CLI command design

The `openbkn` CLI is a single command tree that **merges** two legacy CLIs:
`kweaver` (user/agent) + `kweaver-admin` (operator). Built on `commander`,
with `chalk` + `cli-table3` for pretty output — no TUI. The tree must stay **equivalent** to the legacy
CLIs — see [../../test/equivalence/command-map.md](../../test/equivalence/command-map.md) for the full mapping and drop list, enforced by [../../test/equivalence/help.test.ts](../../test/equivalence/help.test.ts).

## Command tree (merged, target)

```text
openbkn
  # auth & config (unified across both legacy CLIs)
  auth      login | logout | status | whoami | list | use | switch | users | token | change-password | export | delete
  config    show | set | set-bd | list-bd
  call      (curl)  curl-style passthrough with auto-injected auth headers

  # knowledge networks  (kept as `bkn` — identical to legacy `kweaver bkn`)
  # NOTE: no `build` here — KN-level build removed; index build = `vega dataset build`
  bkn       list | get | create | create-from-catalog | create-from-csv | update | delete
            | stats | export | validate | push | pull | search | subgraph | resources
            object-type | relation-type | relation-type-paths | action-type | concept-group | metric
            action-execution | action-log | action-schedule | job

  # decision agents
  agent     list | personal-list | category-list | template-list | template-get
            | get | get-by-key | create | update | delete | publish | unpublish
            | chat | sessions | history | trace | skill
  toolbox   create | list | publish | unpublish | delete | export | import
  tool      upload | list | enable | disable | execute | debug

  # data platform
  resource  (res)  list | find | get | query | delete
  dataflow  list | run | runs | logs | templates | create-dataset | create-bkn | create
  vega      health | stats | inspect | catalog | resource | dataset | query | sql | connector-type
  context   (context-loader)  search-schema | query-object-instance | query-instance-subgraph
            | get-logic-properties | get-action-info | find-skills | tools | resources | resource
            | templates | prompts | prompt | tool-call

  # models, skills, trace
  model     llm <...> | small <...>      # management (mf-model-manager) + runtime (mf-model-api)
  skill     list | get | register | set-status | delete | market | market-get | download | install
            | content | read-file | update-metadata | update-package | history | republish | publish-history
  trace     diagnose | eval-set | schema

  # operator
  org       list | tree | get | create | update | delete | members
  user      list | get | create | update | delete | roles | assign-role | revoke-role | reset-password
  role      list | get | members | add-member | remove-member
  audit     list

  help      [all]   # `help all` dumps full per-action signatures (migration aid)
```

## Root help layout (equivalence target)

`openbkn --help` must reproduce the legacy grouped layout, not commander's flat
default. Section order and command grouping (legacy + the new `OPERATOR` group
for merged admin commands):

```text
openbkn — operate the BKN platform from the CLI

USAGE
  openbkn [global flags] <command> <subcommand> [flags]

AUTHENTICATION & CONFIG   auth · token (→ auth token) · config · call
DECISION AGENT            agent · toolbox · tool
AI DATA PLATFORM          bkn · resource (res) · dataflow · vega · context (context-loader)
TRACE AI                  trace
MODELS & SKILLS           model · skill
OPERATOR                  org · user · role · audit          # merged from kweaver-admin
FOUNDATION                explore · help

FLAGS        --base-url · --token · --user · --json/--compact · -bd · --insecure
ENVIRONMENT  BKN_BASE_URL · BKN_TOKEN · BKN_USER · BKN_PROFILE · BKN_CONFIG_DIR
EXAMPLES / LEARN MORE
```

Implemented as one shared grouped-help formatter over commander
(`configureHelp`/`formatHelp`) — see [tech-stack.md](tech-stack.md). `openbkn help all`
keeps the full per-action signature dump.

### Equivalence is full-depth

Parity is **recursive** — not just the top level. Every legacy command,
subcommand, and sub-subcommand must exist in `openbkn` with equivalent help:

- top: `openbkn --help`
- group: `openbkn agent --help`, `openbkn bkn --help` …
- leaf: `openbkn agent chat --help`, `openbkn bkn object-type --help`
- deep leaf: `openbkn bkn object-type query --help`, `openbkn bkn metric dry-run --help`

The legacy tree is **154 kweaver paths** (from `help all`) + **43 kweaver-admin
depth-2 paths**, enforced by [../../test/equivalence/help.test.ts](../../test/equivalence/help.test.ts).
The same grouped formatter applies at every level: a command's own help groups
its subcommands the way legacy does (e.g. `agent` → DISCOVERY / CRUD / RUNTIME;
`bkn` → LIFECYCLE / LOCAL DIRECTORY / SCHEMA / INSTANCES / EXECUTION). One
formatter reads a `group` tag off each command — no per-command help strings.

## Binary name

The binary is **`openbkn`** (npm package `@openbkn/bkn-sdk`). Subcommand names
are kept **identical** to the legacy CLIs — including the knowledge-network
command `bkn` (`openbkn bkn list`, not a renamed `kn`). Naming `openbkn`
distinct from its `bkn` subcommand avoids any `bkn bkn` doubling while keeping
full command-tree equivalence. Aliases preserved: `res`, `context`, `curl`.

## Global flags

| Flag | Meaning | Env |
| ---- | ------- | --- |
| `--base-url <url>` | Platform base URL | `BKN_BASE_URL` |
| `--token <v>` | Access token (read-only mode if set) | `BKN_TOKEN` |
| `--user <id\|name>` | Use specific user credentials | `BKN_USER` |
| `--json` / `--compact` | Machine-readable output (legacy `--pretty`/`--compact`/`--json` reconciled here) | — |
| `-bd, --biz-domain <s>` | Business domain | — |
| `--insecure, -k` | Skip TLS verification (dev only) | — |

## Conventions

- Each command parses argv, calls a `resources/` function, prints via `utils/output`. No `fetch` in commands.
- `--limit` overrides defaults: list = 30, query/preview = 50.
- Consistent verbs: `list` (many), `get` (one), `create`/`update`/`delete`, plus domain verbs (`push`, `run`, `chat`, `execute`).
- Output: human-aligned columns by default; clean JSON under `--json`; errors to stderr with non-zero exit.

## Open questions

- Canonical JSON flag spelling (`--json` vs `--pretty`/`--compact`) — pick one, alias the rest, document in the command map.
- Whether `explore` (local web UI) fits the backend-only product scope or should be dropped.
