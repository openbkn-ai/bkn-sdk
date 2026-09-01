# CLI command design

The `openbkn` CLI is a single command tree covering both sides of the platform:
a user/agent surface + an operator surface (nested under `admin`). Built on
`commander`, with `chalk` + `cli-table3` for pretty output — no TUI.

## Command tree (merged, target)

```text
openbkn
  # auth & config
  auth      login | logout | status | whoami | list | use | switch | users | token | change-password | export | delete
  config    show | set
  call      (curl)  curl-style passthrough with auto-injected auth headers

  # knowledge networks
  # NOTE: no `build` here — KN-level build removed; index build = `vega dataset build`
  bkn       list | get | create | create-from-catalog | update | delete
            | stats | export | validate | push | pull | search | subgraph | resources
            object-type | relation-type | relation-type-paths | action-type | concept-group | metric
            action-execution | action-log | action-schedule | job

  # tools an agent calls
  toolbox   create | list | publish | unpublish | delete | export | import
  tool      upload | list | enable | disable | execute | debug

  # data platform
  resource  (res)  list | find | get | query | delete
  vega      health | stats | inspect | catalog | resource | dataset | query | sql | connector-type
  context   (context-loader)  search-schema | query-object-instance | query-instance-subgraph
            | get-logic-properties | get-action-info | find-skills | tools | resources | resource
            | templates | prompts | prompt | tool-call [--receipt --json]

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

  help      [all]   # `help all` dumps full per-action signatures
```

## Root help layout

`openbkn --help` uses a grouped layout, not commander's flat default. Section
order and command grouping:

```text
openbkn — operate the BKN platform from the CLI

USAGE
  openbkn [global flags] <command> <subcommand> [flags]

SIGN IN & SETTINGS   auth · config · appkey
DATA & KNOWLEDGE     bkn · vega · resource (res) · context (context-loader)
MODELS               model
TOOLS & SKILLS       skill · toolbox · tool
TRACING              trace
ADMINISTRATION       admin
RAW API              call (curl)

Then, before FLAGS: FIRST STEPS · COMMON TASKS · GOOD TO KNOW · NOT HERE YET

FLAGS        --base-url · --token · --user · --json/--compact · --insecure
ENVIRONMENT  BKN_BASE_URL · BKN_TOKEN · BKN_USER · BKN_PROFILE · BKN_CONFIG_DIR
EXAMPLES / LEARN MORE
```

Implemented as one shared grouped-help formatter over commander
(`configureHelp`/`formatHelp`) — see [tech-stack.md](tech-stack.md). `openbkn help all`
keeps the full per-action signature dump.

### Help is full-depth

Grouped help is **recursive** — not just the top level. Every command,
subcommand, and sub-subcommand carries its own:

- top: `openbkn --help`
- group: `openbkn bkn --help`, `openbkn vega --help` …
- leaf: `openbkn bkn object-type --help`, `openbkn trace diagnose --help`
- deep leaf: `openbkn bkn object-type query --help`, `openbkn bkn metric dry-run --help`

The same grouped formatter applies at every level: a command's own help groups
its subcommands by role (e.g.
`bkn` → LIFECYCLE / LOCAL DIRECTORY / SCHEMA / INSTANCES / EXECUTION). One
formatter reads a `group` tag off each command — no per-command help strings.

## Binary name

The binary is **`openbkn`** (npm package `@openbkn/bkn-sdk`). The
knowledge-network subcommand is `bkn` (`openbkn bkn list`, not a renamed `kn`);
naming the binary `openbkn` — distinct from its `bkn` subcommand — avoids any
`bkn bkn` doubling. Aliases: `res`, `context`, `curl`.

## Global flags

| Flag | Meaning | Env |
| ---- | ------- | --- |
| `--base-url <url>` | Platform base URL | `BKN_BASE_URL` |
| `--token <v>` | Access token (read-only mode if set) | `BKN_TOKEN` |
| `--user <id\|name>` | Use specific user credentials | `BKN_USER` |
| `--json` / `--compact` | Machine-readable output | — |
| `--insecure, -k` | Skip TLS verification (dev only) | — |

## Conventions

- Each command parses argv, calls a `resources/` function, prints via `utils/output`. No `fetch` in commands.
- `--limit` overrides defaults: list = 30, query/preview = 50.
- Consistent verbs: `list` (many), `get` (one), `create`/`update`/`delete`, plus domain verbs (`push`, `run`, `chat`, `execute`).
- Output: human-aligned columns by default; clean JSON under `--json`; errors to stderr with non-zero exit.
- `context tool-call --receipt` is an explicit evidence view. It requires `--json` (and may
  be combined with `--compact`) and returns `{ value, bkn_receipt }`; without it, `tool-call`
  retains its historical business-value-only output.

## Open questions

- Canonical JSON flag spelling (`--json` vs `--pretty`/`--compact`) — pick one, alias the rest.
