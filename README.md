# @openbkn/bkn-sdk

Unified TypeScript SDK + CLI for the **BKN** (Business Knowledge Network) platform.
One toolkit, two surfaces: the importable SDK and the `openbkn` CLI — both backed
by the same domain logic. A slim rewrite of the legacy `kweaver-sdk` +
`kweaver-admin`, merged into one package (the operator CLI lives under
`openbkn admin`). Backend-only; no web UI.

> Status: pre-release. Read commands across all domains are implemented and
> validated against a live platform; some write/mutation paths and the Trace-AI
> engine are still in progress (see `docs/exec-plans/tech-debt-tracker.md`).

## Install

```bash
npm install -g @openbkn/bkn-sdk   # CLI: `openbkn`
# or as a library
npm install @openbkn/bkn-sdk
```

Requires Node ≥ 22.

## CLI

```bash
# Log in (token attach; OAuth flows pending)
openbkn auth login https://your-platform --token "$TOKEN"

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
`test/equivalence/` (run live with `BKN_EQUIV_LIVE=1`).

## License

Apache-2.0
