# @openbkn/bkn-sdk

Unified TypeScript SDK + CLI for the **BKN** (Business Knowledge Network) platform.
One toolkit, two surfaces: the importable SDK and the `openbkn` CLI — both backed
by the same domain logic. A slim rewrite of the legacy `kweaver-sdk` +
`kweaver-admin`, merged into one package (the operator CLI lives under
`openbkn admin`). Backend-only; no web UI.

> Status: every legacy command/subcommand is implemented and full-depth
> `--help`-equivalent with `kweaver` / `kweaver-admin` (196/196 parity test).
> Reads + writes across all domains are validated against a live platform; a few
> paths are environment-gated on the test cluster (EACP `change-password`/`audit`
> upstream, physical-catalog `create-from-*`, populated trace index) — see
> `docs/exec-plans/tech-debt-tracker.md`.

## Install

```bash
npm install -g @openbkn/bkn-sdk   # CLI: `openbkn`
# or as a library
npm install @openbkn/bkn-sdk
```

Requires Node ≥ 22.

## CLI

```bash
# Log in — attach a token, or OAuth (headless password / browser PKCE)
openbkn auth login https://your-platform --token "$TOKEN"
openbkn auth login https://your-platform -u <user> -p <password>   # headless OAuth

# Knowledge networks
openbkn bkn list
openbkn bkn get <kn-id> --stats
openbkn bkn search <kn-id> "customer churn"
openbkn bkn object-type list <kn-id>

# Data platform
openbkn resource list --type table
openbkn vega catalog list
openbkn dataflow list
openbkn model llm list

# Agents
openbkn agent list
openbkn agent sessions <agent-key>

# Operator (kweaver-admin, nested)
openbkn admin org list
openbkn admin role list

# Raw passthrough to any endpoint
openbkn call /api/ontology-manager/v1/knowledge-networks

# Global flags: --base-url, --token, --user, --json/--compact, -bd/--biz-domain, -k/--insecure
openbkn --help        # grouped command map
```

Tokens are stored per platform/user under `~/.bkn/` (override: `BKN_CONFIG_DIR`).

## SDK

```ts
import { createClient } from "@openbkn/bkn-sdk";

const bkn = createClient({ baseUrl: "https://your-platform", token: process.env.BKN_TOKEN });

const networks = await bkn.kn.list({ limit: 10 });
const task = await bkn.vega.build({ resource_id: "r-1", mode: "batch" }, { wait: true });
const raw = await bkn.call("/api/...", { method: "GET" });
```

Importing the package has no side effects; `createClient` resolves config explicitly.

## Develop

```bash
npm install
npm run lint     # biome + tsc --noEmit
npm test         # vitest (unit; equivalence suite gated by BKN_EQUIV_LIVE)
npm run build    # tsup → dist/ (library + `openbkn` bin)
```

## Equivalence with the legacy CLIs

`openbkn` mirrors the installed `kweaver` / `kweaver-admin` command trees
(`kweaver <x>` → `openbkn <x>`, `kweaver-admin <x>` → `openbkn admin <x>`).
Golden `--help` baselines and a full-depth parity test live in
`test/equivalence/` — **196/196** commands match (every node exists and its
`--help` covers the legacy flags + arguments). Run live with `BKN_EQUIV_LIVE=1`.

## Agent skill

`skills/openbkn/` is an agent skill (for Claude Code / the [skills.sh](https://skills.sh)
ecosystem) that lets an AI drive the `openbkn` CLI from natural language. It
ships a `SKILL.md` (trigger intents, `allowed-tools: Bash(openbkn *)`, a
command-group map, examples, and cautions) plus per-domain cheat sheets under
`references/` (auth, bkn, agent, model, vega, resource, dataflow, context,
skill, toolbox, trace, admin, call) and two how-tos (build-a-KN, troubleshooting).

A second skill, `skills/create-bkn/`, guides an AI through **authoring** a BKN
definition tree (`network.bkn` + typed `object_types/` / `relation_types/` /
`action_types/` / `concept_groups/` files, per the v2.0.1 spec) — with the
format spec, templates, and a worked example under `references/`. It pairs with
the `openbkn` skill, which then runs `openbkn bkn validate` / `push` on the
tree it produced.

Neither skill is part of the npm package — they're registered separately:

```bash
# Install a skill (globally), then ask in natural language:
npx skills add openbkn-ai/bkn-sdk@openbkn -g -y      # operate the platform
npx skills add openbkn-ai/bkn-sdk@create-bkn -g -y   # author .bkn files

#   "列出所有知识网络"  /  "list all knowledge networks"
#   "从 Vega catalog vcat-1 建一个名为 customers 的知识网络并构建索引"
#   "帮我建一个描述订单域的 BKN 知识网络文件"  /  "author a BKN network for the orders domain"
```

The `openbkn` skill assumes the `openbkn` CLI is installed (`npm i -g
@openbkn/bkn-sdk`) and you are logged in (`openbkn auth login`). It always defers
to live `openbkn <group> <sub> --help` for exact flags.

## License

Apache-2.0
