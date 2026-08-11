# Python OSDK — generated, read-only ontology SDK

## Intent

Give Python agent/application developers a typed, network-specific SDK for a single
knowledge network, produced by **static code generation** from that network's schema.
Modelled on Palantir's OSDK: point the generator at a KN, get a Python package whose
classes *are* that KN's object types.

```python
from bkn.object_types import People

People.where(People.age > 30).take(10)
```

This replaces the earlier proposal of a hand-written general-purpose Python client.
The generic HTTP surface (agents, dataflows, admin, vega, …) stays TypeScript-only —
it is thin HTTP wrapping with no Python-specific value.

## Non-goals

First release deliberately excludes:

- **Writes** — no instance mutation, no `action_type` execution. Deferred, not designed out:
  see [Writes and actions](#writes-and-actions) for the shape it takes when it lands.
- **Aggregation beyond `count()`** — no `sum`/`avg`/`group_by` on an object set. See
  [Aggregation](#aggregation).
- **Generated MCP tool wrappers** — deferred to v1.1, see
  [Deferred increment](#deferred-increment-generated-mcp-tool-wrappers).
- Concept groups, action schedules, action logs.
- An async client (sync only; async is a runtime-level addition later).
- Offline generation from a local `.bkn` directory (that format is Markdown tables —
  see [Rejected alternatives](#rejected-alternatives)).
- A Python port of any other SDK domain.

## Architecture

Three blocks, three lifecycles:

| Block | Language | Location | Contents |
| --- | --- | --- | --- |
| Generator core | Python | `python/bkn_osdk/codegen/` | Pure function `schema → file tree`. No IO, no auth. |
| Runtime | Python | `python/bkn_osdk/` | HTTP, authentication, paging, query evaluation, deserialization, base classes. Published to PyPI as `bkn-osdk`. |
| Generated package | Python | the user's repository | Schema shape only: classes, literal ids, type annotations, property descriptors. Zero logic. |

Everything is Python, so a consumer needs only `pip`. Hosting the generator on the existing
TypeScript CLI was considered and rejected — see [Rejected alternatives](#rejected-alternatives).

The split exists so the two evolution axes decouple:

- Runtime gains an operator or fixes a bug → `pip install -U bkn-osdk`, **no regeneration**.
- KN schema changes → regenerate, **runtime untouched**.

**The generator core must stay a pure function.** Its signature is
`generate(schema: KnSchema, options: GenOptions) -> dict[str, str]` mapping relative path to
file content; it never fetches and never touches the filesystem. Three shells supply IO:

- CLI shell — resolves credentials, fetches schema, writes to disk.
- Test shell — reads a fixture schema, compares against golden files.
- Future server shell — the backend already holds the schema, packages the result as a wheel.

Violating this boundary (inlining an HTTP call or a file write into the generator) forces a
rewrite when server-side generation arrives, so it is a review-enforced rule.

Output must be byte-stable for golden-file tests, so the generator emits with plain string
templates and a fixed key order — no template engine, no formatter shelling out, no
dict-iteration-order dependence.

## Generation source

Schema comes from **ontology-manager REST** — the authoritative schema layer, which needs
no managed lifecycle session:

- `GET /api/ontology-manager/v1/knowledge-networks/{id}` — network metadata.
- `GET …/{id}/object-types?branch=main&limit=-1` — [`api/knowledge-networks.ts:251`](../../../src/api/knowledge-networks.ts#L251).
- `GET …/{id}/relation-types?branch=main&limit=-1` — same file, `listRelationTypes`.

Not the MCP `get_kn_detail` tool: that is the agent-facing progressive-disclosure surface,
subject to dedup and the lifecycle contract, and is the wrong source of truth for codegen.

## Generation command

A console script shipped by the `bkn-osdk` distribution, so a Python consumer never installs
Node:

```bash
pip install bkn-osdk
bkn-osdk generate <kn-id> --out ./bkn [--branch main] [--package bkn]
bkn-osdk check                            # compare live schema against a generated package
```

`check` exits non-zero on drift; it is the CI gate.

Fetching the schema costs two GET calls and reuses the runtime's own `config.py` and
`http.py` — the runtime must implement credential resolution and HTTP regardless, to execute
queries at all, so the generator adds no transport code.

**Generation authenticates before it writes anything.** `generate` resolves credentials through
the same chain as a query, and a missing, expired, or revoked token fails the command with the
platform's own message — an AppKey 401 says to re-issue the key, not to retry
([`api/http.ts:88-97`](../../../src/api/http.ts#L88-L97)). Nothing reaches the output directory
unless every schema fetch succeeded: the generator returns a complete file map or raises, and
the CLI shell writes only on success. A half-written package that imports but silently omits
object types would be worse than no package, because the failure would surface later as a
missing attribute rather than as an authentication error.

`--out` is refused if it exists and was not produced by this generator (checked via `_meta.py`),
so a mistyped path cannot overwrite unrelated source.

## Generated package layout

One knowledge network = one top-level Python package, **lowercase**, as PEP 8 asks of package
names:

```text
bkn/
  __init__.py          # KN_ID, BRANCH, OBJECT_TYPES / RELATION_TYPES registries
  object_types.py      # one class per object type
  relation_types.py    # relation endpoint definitions
  _meta.py             # kn_id, branch, fingerprint, format + runtime version
```

```python
from bkn.object_types import People
```

Module names mirror the BKN specification's directory names (`object_types/`,
`relation_types/`) so the vocabulary is identical for whoever authors the KN and whoever
imports it.

The default package name is the **KN id**, not the display name. Ids are already lowercase
ASCII with underscores (`ecommerce_ops_bkn_public`, `supplychain_bkn_v4_new2`), so they are
valid identifiers as-is, they are unique within a platform, and they do not move when someone
renames the network. Display names are none of those things — the live platform's are Chinese
(`电商经营决策知识网络`) and two networks may share one.

`--package` overrides it, and **non-ASCII package names are supported**: PEP 3131 permits them
and `from 报名.object_types import People` was verified to import. One caveat, and it only bites
in delivery modes B and C: a *distribution* name (what `pip install` takes) must be ASCII, so a
Chinese package would need an ASCII distribution name wrapping it. Import name and distribution
name are allowed to differ, so this constrains packaging metadata, not the import.

Two networks are two independent packages, so identically-named object types never collide.

## User-facing API

```python
from bkn.object_types import Bom, Material, People

# Class-level attribute access returns a descriptor used to build filters.
People.name == "Zhang San"
People.age > 30                                  # int comparison; `>` on a str property fails mypy

# Read-only queries — the class itself is the ObjectSet root.
People.get("p-001")                              # People | None
People.where(People.age > 30).take(10)           # list[People]
People.where(People.age > 30).iterate()          # generator, pages automatically
People.where(People.age > 30).order_by(People.age.desc()).take(10)
People.where(People.age > 30).count()            # int, respects the filter
People.where(People.embedding.near(vec, k=20))   # knn, on properties that carry a vector index

# Boolean composition maps onto the platform's nested condition tree.
People.where((People.age > 30) & (People.dept.is_in(["ops", "cs"])))

# Instance-level access to the same name returns the value.
p = People.get("p-001")
p.name                                           # str
p.age                                            # int
p.__identity__                                   # {"person_id": "p-001"}

# Relation traversal.
b = Bom.get("b-1")
b.material.take(100)                             # list[Material]

# Classes are ordinary classes, so they annotate naturally.
def rank(people: list[People]) -> list[People]: ...
```

`count()` and `order_by()` ride the REST read path, which is the only one that offers a total
or a sort — see [Instance query contract](#instance-query-contract).

Semantic search is **network-level, not object-type-level**: its request body is
`{kn_id, query, mode, max_concepts, return_query_understanding}` with no object-type
dimension ([`api/knowledge-networks.ts:429-437`](../../../src/api/knowledge-networks.ts#L429-L437)).
It is therefore exposed on the package, not on a class, and returns the platform's search
result rather than a typed object set:

```python
import bkn
bkn.search("who owns supply chain")              # KN-level search result
```

Whether a search hit can be resolved back into a typed instance depends on its response shape,
which is not yet captured; until then `bkn.search` returns the raw result.

`People.name` (a `PropertyRef`) and `p.name` (a `str`) share a name because `Property`
implements the descriptor protocol: `__get__(self, obj, owner)` returns the `PropertyRef`
when `obj is None` (class access) and the deserialized value otherwise.

Enumeration lives at package level:

```python
import bkn
bkn.OBJECT_TYPES            # tuple[type[ObjectType], ...]
bkn.KN_ID, bkn.BRANCH
```

A generated class carries only declarations:

```python
# bkn/object_types.py — generated
from bkn_osdk import ObjectType, Property, Relation

class People(ObjectType):
    __kn_id__ = "kn-a3f9"
    __bkn_id__ = "people"
    __primary_key__ = ("person_id",)

    person_id = Property[str]("person_id")
    name      = Property[str]("name")
    age       = Property[int]("age")

    manager   = Relation["People"]("people_to_manager")
```

`where` / `order_by` / `take` / `iterate` / `count` / `get` are all inherited from `ObjectType`;
the generated file defines no methods.

## Aggregation

Statistics have two possible backings on this platform, and they are not equivalent.

**Metrics are the first-class one**, and the richer surface — verified against the live
platform, `query_metric` supports everything the instance query lacks:

| Field | Meaning |
| --- | --- |
| `condition` | Same recursive grammar as `query_object_instance` |
| `analysis_dimensions` | Split results by dimension; values must come from `related_metrics[].analysis_dimensions` |
| `time` | `{start, end, step, instant}` — instant point or a series over `day`/`week`/`month`/`quarter`/`year` |
| `having` | Filter on the aggregated result |
| `order_by` | `[{property, direction: asc\|desc}]` — the only sorting anywhere in the read surface |
| `limit` | Row cap |

A metric is also a *schema artifact* (`listMetrics` / `getMetric`, and `related_metrics[]` on an
object type), which makes it exactly the kind of thing a generator should emit:

```python
from bkn.metrics import GmvByChannel

GmvByChannel.query(
    time={"start": 1751328000, "end": 1753920000, "step": "day"},
    analysis_dimensions=["channel_id"],
    order_by=[("gmv", "desc")],
)
```

It inherits everything else in this design: parameters typed from the metric definition,
`__bkn_id__` carrying the real id, drift covered by the same fingerprint. The time-window rules
are constrained enough to encode in the signature rather than leave to runtime errors —
`instant=True` takes a point, otherwise `step` is mandatory, and `start`/`end` come as a pair.

**Ad-hoc aggregation over an object set** — `People.where(…).aggregate(avg(People.age),
group_by=People.dept)` — has no backing. Neither read path exposes an aggregate or a grouping;
REST's `need_total` gives a row count and nothing more.

So the release ladder is:

1. **This release:** `count()` only, via REST `need_total`.
2. **Next:** generated `bkn.metrics` over `query_metric`. The contract is known, so this is
   ordinary work rather than discovery.
3. **Only if the backend adds it:** `aggregate()` on an object set.

## Class and property naming

BKN object-type ids are lowercase-with-underscores (specification-enforced) and map to
PascalCase class names: `people → People`, `monitoring_task → MonitoringTask`. The original
id is preserved as `__bkn_id__` and is what the runtime transmits — nothing ever reverses a
class name back into an id.

Two edge cases:

- **Name collision** (`po` and `p_o` both yielding `Po`) — the generator fails with both
  offending ids and requires the KN to be fixed. It does not silently disambiguate.
- **Python keyword** (`class`, `import`, `from`) — suffixed with an underscore (`Class_`),
  `__bkn_id__` unchanged.

Primary keys come from the specification's `### Keys` → `Primary Keys` and determine the
`get()` signature: a single key gives `get(value)`, a composite key gives
`get(part_a=…, part_b=…)`.

## Type mapping

From the BKN specification's standard type table:

| BKN | Python |
| --- | --- |
| `string`, `text` | `str` |
| `integer` | `int` |
| `float` | `float` |
| `decimal` | `decimal.Decimal` — the wire carries it as a JSON string (`"14485.37"`), so `Decimal(str)` is exact |
| `boolean` | `bool` |
| `date` | `datetime.date` |
| `time` | `datetime.time` |
| `datetime` | `datetime.datetime` — ISO 8601 with offset, via `fromisoformat` |
| `json` | `Any` |
| `binary` | `bytes` |
| anything else | `Any` |

The specification states that non-standard types pass through unchanged; the generator does
the same rather than guessing.

## Runtime package

`bkn-osdk` on PyPI, import name `bkn_osdk`:

```text
bkn_osdk/
  config.py      # configure(), session(); ContextVar → env → ~/.bkn store resolution
  http.py        # httpx client, timeouts, 401 refresh, retries
  errors.py      # HttpError, InputError, SchemaDriftError, ObjectNotFound
  types.py       # ObjectType, Property, Relation — the generated classes' base
  query.py       # Filter → condition tree; ObjectSet evaluation; where/take/iterate
  mcp.py         # MCP transport: tools/call, receipt extraction
  lifecycle.py   # managed session — every read needs one
  search.py      # network-level semantic search
  meta.py        # schema fingerprint + runtime version-range checks
  codegen/       # pure generator + the bkn-osdk console script
```

`lifecycle.py` is not an optional extra: `query_object_instance` requires a `bkn_context`, so a
session is opened for the first read and reused for subsequent ones within the same
`session(...)` scope, then finished on scope exit. Opening one interaction per query would both
cost a round trip and fragment the evidence chain into unrelated interactions.

Generated packages import from `bkn_osdk` and from nothing else. `codegen/` ships in the same
distribution but is imported only by the console script, so it costs an installed consumer
nothing at runtime; the runtime's only hard dependency is `httpx`.

## Authentication and context propagation

Generated code contains **no credentials and no base URL** — the same KN commonly exists on
both a dev and a prod platform. It pins only `kn_id` and `branch`.

Because queries are issued from class-level calls (`People.take(10)`), the credentials have
to reach them without appearing in the signature. The runtime carries them in a
`contextvars.ContextVar`, resolved in this order:

1. The innermost active `session(...)` scope.
2. The process default set by `bkn_osdk.configure(...)`.
3. `BKN_TOKEN` / `BKN_BASE_URL`.
4. `~/.bkn/platforms/<base64url(baseUrl)>/users/<userId>/token.json` — the same store the
   `openbkn` CLI writes.

```python
import bkn_osdk
from bkn_osdk import session
from bkn.object_types import People

# Notebook or script: nothing to configure, falls through to env + ~/.bkn.
People.where(People.age > 30).take(10)

# Explicit process default.
bkn_osdk.configure(base_url=PROD, token=T)

# Server handling requests for different users, or a second platform: a scope per request.
with session(token=user_token):
    People.take(10)

# For callers who prefer no ambient state at all.
People.with_context(ctx).where(People.age > 30).take(10)
```

A `ContextVar` is what makes this safe rather than a disguised global: each thread and each
asyncio task gets its own value, so a multi-tenant server cannot leak one user's token into
another's request, and tests need no global teardown. Import remains side-effect-free, matching
the TypeScript SDK's stance that `createClient` resolves configuration explicitly.

AppKeys (`bak_…`) travel the same path. Because generated output is credential-free, it is
safe to commit to a user repository or to hand out as a downloadable archive.

## Versioning and schema drift

`_meta.py` carries a **schema fingerprint** — a stable hash over every object/relation type's
id, property names, and property types — plus the runtime version range the generator
targeted:

```python
SCHEMA_FINGERPRINT = "a3f9c2e1…"
FORMAT_VERSION = 3                 # shape of the emitted code
REQUIRES_RUNTIME = ">=0.3,<0.4"
GENERATED_BY = "bkn-osdk 0.3.1"
```

- The runtime validates `REQUIRES_RUNTIME` at import and refuses to run a mismatched pair,
  reporting whether to regenerate or to upgrade.
- Schema drift is **not** checked per request (that would cost an extra round trip).
  `bkn-osdk check` compares live schema against the fingerprint and is the CI gate;
  `configure(check_schema=True)` opts into a one-time check at runtime, raising
  `SchemaDriftError`.

Package versions derive from the fingerprint rather than being hand-written:

```text
BKN-test  0.1.0+main.a3f9c2e1
```

An unchanged schema regenerates to the same version (installs stay idempotent); any schema
change moves it visibly.

The `+…` segment is a PEP 440 *local version identifier*. Rejecting those is PyPI **policy**,
not a rule of the packaging standard — pip installs them happily, and a self-hosted index is
free to serve them. Since these packages are never destined for public PyPI, the scheme also
survives into delivery mode C below.

## What the Python side does *not* replicate

The TypeScript SDK exposes eleven resource namespaces. The Python side ports **none of them**,
and that is a decision worth defending rather than a gap.

Those namespaces are HTTP wrapping: build a URL, send JSON, return JSON. Porting them buys a
Python caller nothing that `bkn_osdk.call()` plus the endpoint path does not, while costing a
permanent second implementation to keep in step with every backend change. The OSDK is the
opposite case — generated typed classes over an ontology cannot be replaced by a raw call, which
is exactly why it is worth building in a second language.

So the runtime ships one generic escape hatch rather than eleven typed namespaces:

```python
bkn_osdk.call("/api/dataflow-manager/v1/flows", method="GET")
```

It reuses the same credential resolution, error mapping, and session handling as a query, and it
covers 100% of the remaining backend surface in roughly ten lines.

Two exceptions deserve consideration, both already half-built by this design:

- **Trace lifecycle.** `lifecycle.py` must open, reuse, and finish managed sessions for the MCP
  read path regardless. Exposing that as `bkn_osdk.trace` — start an interaction, record
  operations, submit an answer — is a small delta over code that has to exist, and it is what a
  Python agent needs to put its own reasoning into the evidence chain alongside the SDK's reads.
- **Semantic search**, already exposed as `bkn.search` because it is ontology-shaped.

Anything else gets ported when a real Python caller asks for it, not by symmetry with the
TypeScript surface. Porting by symmetry is how the legacy Python SDK became a maintenance
liability worth deleting.

## Deferred increment: generated MCP tool wrappers

Not in the first release. Recorded here because the decision was made deliberately and the
constraint it carries is easy to get wrong later.

The deploy's MCP catalog is an unusually good generation source: 23 tools, each publishing a
complete `inputSchema` **and** `outputSchema`. Turning it into typed Python is mechanical —
`required` becomes positional parameters, the rest keyword-only with the schema's own defaults,
`enum` becomes `Literal[...]`, `outputSchema.properties` becomes a `TypedDict`, and the tool's
`description` becomes the docstring:

```python
# bkn/tools.py — generated from tools/list
from typing import Any, TypedDict
from bkn_osdk import mcp


class RunSqlResult(TypedDict):
    columns: list[Any]
    entries: list[Any]
    total_count: int
    warnings: list[Any]


def run_sql(sql: str, *, query_timeout: int | None = None) -> RunSqlResult:
    """Run one read-only SELECT statement in MySQL SQL against data resources
    mounted by a knowledge network. Use table placeholders such as {{.resource_id}}."""
    return mcp.call("run_sql", {"sql": sql, "query_timeout": query_timeout})
```

Three emission rules:

- **Three arguments never appear in a signature.** `bkn_context` is required by every tool but
  is the runtime's to inject — exposing it leaks session management to the caller. `kn_id` is
  already pinned in `_meta.py`. `response_format` defaults to `toon` and the runtime always
  sends `json`, so offering the choice only lets a caller select an unparseable response.
- **Lifecycle tools are excluded** (`bkn_start_interaction`, `bkn_finish_interaction`): the
  runtime owns session state, and a caller invoking them directly would corrupt it.
- **Tools the OSDK already models are excluded** (`query_object_instance`, `query_metric`,
  `query_instance_subgraph`): `People.where(…)` already covers them, and shipping both would be
  two APIs for one capability.

What remains is genuine net gain: `run_sql`, `search_schema`, `describe_resource`,
`list_resources`, `find_skills`, `get_action_info`, `execute_action`, `get_skill_content`,
`execute_skill`, `list_action_executions`.

This does not contradict [What the Python side does not replicate](#what-the-python-side-does-not-replicate).
That section rejects *hand-maintained* ports — a permanent second implementation tracking every
backend change. Generated wrappers over a published schema cost nothing to maintain; when the
schema moves, regenerate.

**The reason to defer is drift granularity, and it is a real constraint.** Object-type schema is
per-KN: push the same KN to dev and prod and the generated classes are identical, which is why
the package pins no base URL. A tool catalog is *per-deploy* — backend versions expose different
tools, and `run_sql`'s dialect is a property of the deploy, not of the KN. Merging both into one
package would bind it to a single deploy and quietly undo that portability.

So when it lands it carries three constraints:

1. `tools.py` is a separate module behind an explicit `--with-tools`, never a default artifact.
2. Fingerprints stay separate — `SCHEMA_FINGERPRINT` (per KN) and `TOOLS_FINGERPRINT`
   (per deploy) — and `bkn-osdk check` reports them independently.
3. A package containing `tools.py` validates the catalog at import and fails with a regenerate
   instruction, rather than raising "unknown tool" at call time.

## Upgrades

Three things can move independently, and each has its own trigger and its own guard:

| What moves | User action | Guard |
| --- | --- | --- |
| Runtime (bug fix, new operator, cursor support) | `pip install -U bkn-osdk` | `REQUIRES_RUNTIME` range in `_meta.py` |
| KN schema (new object type, property, retype) | `bkn-osdk generate` again | `SCHEMA_FINGERPRINT` + `bkn-osdk check` |
| Emitted code shape (we change what the generator writes) | regenerate | `FORMAT_VERSION` |

**Runtime upgrades never require regeneration.** That is the point of keeping the generated
package logic-free: adding `order_by`, switching paging to a cursor, or fixing a decimal
round-trip all live in `bkn_osdk` and reach existing generated packages through `pip`.

**`FORMAT_VERSION` is separate from the runtime version** because the two break in opposite
directions. A runtime must keep reading packages generated before it — so it supports the
current format version and the one before it, giving users a release of grace to regenerate.
Dropping support is a major bump and fails loudly:

```text
bkn_osdk.FormatVersionError: package 'bkn' uses generated format 1,
supported: 2, 3. Regenerate with: bkn-osdk generate ecommerce_ops_bkn_public --out ./bkn
```

**Schema upgrades are a reviewable event, not a surprise.** Because generation is deterministic,
regenerating an unchanged schema produces a byte-identical tree and an empty `git diff` — so the
diff of a real regeneration *is* the changelog. `bkn-osdk check` classifies the delta, since the
fingerprint alone only says "different":

- *Additive* — new object type, new property, new relation. Existing code keeps working.
- *Breaking* — property removed or retyped, object type removed, primary key changed. Existing
  code breaks at the attribute or in `mypy`.

Failing loudly is deliberate: a removed property becomes an `AttributeError` at the call site
rather than a silent `None`. Keeping deprecated stubs around would trade a clear break for a
wrong answer.

The version string carries the fingerprint (`0.1.0+main.a3f9c2e1`), so in delivery modes B and C
the schema change is visible in the lockfile diff rather than hiding behind an unchanged version
number.

Recommended consumer setup: commit the generated package, pin `bkn-osdk~=0.3`, and run
`bkn-osdk check` in CI. Then a schema change fails the build with a diff to review, and a runtime
upgrade is an explicit, separate commit.

## Errors

The runtime mirrors the TypeScript error semantics — `HttpError` (status plus the
next-step hint logic in [`api/http.ts:88-131`](../../../src/api/http.ts#L88-L131), including the
AppKey-401 and lifecycle-session hints), `InputError`, `ToolError` — and adds two
Python-side types: `SchemaDriftError` and `ObjectNotFound`.

Tool errors arrive as a structured envelope with `code`, `required_action`, `retryable`, and
`retry_after_ms`. `retryable` is honored rather than guessed at: `conversation_required` is
`retryable: false` and means the session was not opened, which is a runtime bug to surface, not
a condition to retry into.

`ObjectSet.raw(dict)` stays as a permanent escape hatch — it sends a `query_object_instance`
argument map verbatim. It exists not because the grammar is unknown (it is not) but because the
tool schema can gain fields faster than the generator models them.

## Testing

- **Generator** — golden-file tests. A fixture schema JSON generates a file tree compared
  byte-for-byte against committed goldens; changing the generator requires updating goldens
  in the same commit.
- **Generated output** — a package is generated from the fixture network, then checked with
  `mypy --strict` and pytest, asserting that `People.name` is a `PropertyRef[str]` and
  `p.name` is a `str`.
- **Runtime** — recorded HTTP fixtures shared with the TypeScript side so both languages
  assert the same wire behavior.
- **Context isolation** — concurrent tasks under different `session(...)` scopes must each
  send their own token; a regression here is a cross-tenant credential leak, so it gets an
  explicit test rather than relying on `ContextVar` semantics being obviously correct.

All three generator-side layers run in one `pytest` invocation — generator, generated output,
and runtime share a toolchain, which is the main practical dividend of not writing the
generator in TypeScript.

## Repository layout and CI

Single repository, with the whole Python side self-contained under `python/`:

```text
bkn-sdk/
  python/
    bkn_osdk/
      codegen/          # generator core (pure) + the bkn-osdk console script
      …                 # runtime modules
    tests/
      fixtures/         # schema JSON + golden files
    pyproject.toml
  fixtures/             # shared with TypeScript: recorded HTTP exchanges
```

Because the generator is Python, `python/` no longer straddles a language boundary and could
in principle live in its own repository. Keeping it here is still the better default: the
schema-source knowledge lives in this repo, wire-behavior fixtures are shared with the
TypeScript client so both assert the same backend contract, and there is one issue tracker for
one platform. The decision is cheap to reverse later precisely because `python/` is
self-contained.

CI adds a Python job (ruff, `mypy --strict`, pytest) running alongside `npm run ci`.

Published artifacts stay at two: `@openbkn/bkn-sdk` on npm (unchanged — it gains no generator)
and `bkn-osdk` on PyPI. Generated packages are not published in this release — they live in
user repositories or are produced in user CI.

## Future: server-side generation

Three delivery modes, sharing one generator:

| Mode | User action | Infrastructure |
| --- | --- | --- |
| A (this release) | `bkn-osdk generate` | none |
| B | download a wheel from the platform | one endpoint |
| C | `pip install BKN-test --index-url https://platform/simple` | package index, versioning, auth |

B is a wrapper around A; C is an extension of B. Palantir ships C. Nothing here needs
building now — the pure-function generator boundary is the only thing that must hold for B
and C to be additive.

When B or C arrives, the platform runs **this** generator rather than reimplementing it in
the backend's language; a second source of generation logic is exactly the drift that
retired the legacy Python SDK. A Python backend imports `bkn_osdk.codegen` directly; a
backend in another language shells out to the console script or fronts it with a small
service.

### Mode C is our own index

`https://platform/simple` is the platform's own host — hosting a package index is a much
smaller job than it sounds. PEP 503, the Simple Repository API, is a static HTML listing:

```text
/simple/                                  → one <a href> per project
/simple/bkn-test/                         → one <a href> per file, each with #sha256=…
/packages/BKN_test-0.1.0+main.a3f9c2e1-py3-none-any.whl
```

No package-index software is required — the backend can serve those three routes and
generate wheels on demand, keyed and cached by schema fingerprint.

Two details decide whether it is pleasant to use:

- **Authentication.** pip supports HTTP Basic in the URL, `~/.netrc`, and keyring, so an
  existing platform token works as the password with no new credential type.
- **Dependency resolution.** `--index-url` *replaces* PyPI, so a bare platform index leaves
  `bkn-osdk` and `httpx` unresolvable. Either the index proxies PyPI for anything it does not
  own, or users pass `--extra-index-url` instead. `--extra-index-url` carries the standard
  dependency-confusion caveat (pip picks the highest version across all indexes, so a public
  package sharing the name wins on version), which argues for the proxying index and a
  reserved name prefix such as `bkn-kn-*`.

## Writes and actions

Palantir's OSDK does support writes, and its model is instructive: **no direct property
assignment**. Every mutation goes through a typed Action, generated from the ontology's action
definitions. BKN has the same shape — `action_type` is a first-class schema entity with a
declared input schema, retrievable via
[`getActionTypeInputs`](../../../src/api/knowledge-networks.ts#L197) and executed through
`POST …/action-types/{id}/execute`.

Deferred here only because the first release is scoped to reads. Nothing in the design has to
change to admit it — it is a fourth generated module:

```python
from bkn.action_types import ApproveOrder

ApproveOrder.execute(order_id="o-1", approver="u-9")   # parameters typed from the input schema
```

Two things are worth stating now, because they answer the obvious objections:

- **Writes do not force extra regeneration.** Regeneration is triggered by *schema* change,
  never by data change. Executing an action no more invalidates the generated package than
  reading an instance does. The trigger is identical for reads and writes: a new object type, a
  new property, a new action, or a changed action-input schema. Adding an action parameter is
  the same kind of event as adding a property, handled by the same fingerprint.
- **Actions have a discoverable contract, unlike instance queries.** `getActionTypeInputs`
  returns a declared input schema, so the typed parameter list can be generated from a real
  source rather than reverse-engineered. In that respect writes are *better specified today*
  than `where()` is.

The genuinely new work writes bring is the trace/lifecycle contract: an execution is an
operation that the platform records, so `execute()` must open a managed lifecycle session and
surface the receipt, rather than being a bare POST. That is why it is a separate increment and
not a footnote on this one.

## Rejected alternatives

- **Hand-written general-purpose Python client** — the original proposal. Rejected: the
  generic surface is HTTP wrapping with no Python-specific value, and it would double
  maintenance for every backend change.
- **Runtime-dynamic SDK** (`__getattr__` proxies plus a meta-path import hook, schema fetched
  at import). Rejected: no IDE completion, no static type checking, network IO at import
  time, and a fragile custom importer.
- **Attribute-chained namespace** (`from bkn import Test; Test.person`) — the first sketch.
  Rejected in favor of `from bkn.object_types import People`: completion fires at the import
  line, the class annotates cleanly, and nothing depends on runtime attribute magic.
- **Generating from a local `.bkn` directory** — the authoring format is Markdown with
  frontmatter and property tables, so it would need a Markdown-table parser and would lag the
  platform's resolved schema. Possible later as `--from-dir`.
- **One package containing several networks** — collides on object-type names and couples
  unrelated regeneration cycles.
- **Hosting the generator on the TypeScript CLI** (`openbkn py generate`, generator in
  `src/codegen/`) — the earlier plan. Rejected: it would make every Python consumer install
  Node to obtain a Python package. The apparent saving was illusory, since the runtime must
  implement credential resolution and HTTP anyway to execute queries, leaving the generator's
  marginal transport cost at two GET calls. Writing the emitter in the same language as the
  emitted code also lets one `pytest` run cover generator, generated output, and runtime.
- **Global `configure()` as the only credential path** — rejected because one process cannot
  then address two platforms, a multi-tenant server cannot hold per-request tokens, and
  concurrent tasks would interleave credentials. The `ContextVar` scope keeps the terse
  class-level call while remaining thread- and task-safe.
- **Threading an explicit `ctx=` through every call** — safest, but it appears on every line
  of every chain and would make the terse form the design exists for impossible.

## Instance query contract

Verified against a live platform (`https://14.103.77.23`, KN `ecommerce_ops_bkn_public`) on
2026-08-11. This section records observed behavior, not inference.

### Two read paths, and which one wins

There are two, they take the **same filter grammar**, and each has something the other lacks:

| | REST `ontology-query` | MCP `query_object_instance` |
| --- | --- | --- |
| Lifecycle session | not required | **required** (`bkn_context`) |
| Total count | **yes**, via `need_total: true` | no — `need_total` is silently ignored |
| Sorting | **yes**, via `sort` | none at all |
| Evidence receipt | no | **yes** (`bkn_receipt`) |
| `condition` grammar | same | same |
| `limit` / `offset` | yes | yes |
| Response envelope | `{datas, total_count, overall_ms, search_from_index}` | `{datas}` + receipt |

**REST is the default read path.** It is strictly more capable for reading — it restores
`count()` and it is the only place ordering exists — and it costs no session round trip. MCP
becomes an opt-in mode, `session(traced=True)`, for callers who need every read to land in the
evidence chain.

That is a reversal of an earlier draft of this document, which had bound to MCP on the grounds
that only it published a JSON Schema. It does publish one, and that schema is how the grammar
below was recovered — but the grammar turns out to be shared, so the schema serves as
documentation for both paths while the request goes to the more capable one.

The MCP path's requirement is absolute: `kn_id`, `ot_id`, and `bkn_context` are all mandatory,
and a call without a session fails with

```json
{"error":{"code":"conversation_required","required_action":"bkn_start_interaction","retryable":false}}
```

`bkn_start_interaction` alone returns both `conversation_id` and `interaction_id` on this
deploy; there is no separate `bkn_create_conversation` in its catalog.

The REST path did **not** require a session here, but the TypeScript client already carries
next-step hints for deploys that demand one
([`api/http.ts:104-131`](../../../src/api/http.ts#L104-L131)), so the runtime treats
`conversation_required` from REST as "open a session and retry once" rather than as a fatal
error. A deploy that enforces the lifecycle contract everywhere then works without a code change.

### Filter grammar

A single recursive `condition` object:

```json
{"operation":"and","sub_conditions":[
  {"operation":"==","field":"order_status","value":"pending_payment","value_from":"const"},
  {"operation":"in","field":"channel_id","value":[1,3],"value_from":"const"}]}
```

Operators: `and`, `or`, `==`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not_in`, `like`, `not_like`,
`exist`, `not_exist`, `match`, `knn`. `knn` additionally takes `limit_key: "k"` and
`limit_value`, which gives the OSDK a typed vector-search entry point on embedded properties.

The `filters` array in the same schema is marked *"Legacy flat filters. Prefer condition"* and is
not used.

**`condition_operations` on a property is advisory, not a whitelist.** Object-type schemas
carry a per-property `condition_operations` list, but it is neither necessary nor sufficient:
`order.order_id` (integer) declares none yet filters correctly with `>`, and the lists contain
`range`, `out_range`, and `regex`, which the tool's own `operation` enum does not accept. The
generator therefore derives permitted operators from the **tool enum plus the property's Python
type**, and ignores `condition_operations`.

### Paging

`limit` + `offset` work on both paths (`offset: 2` returned the third and fourth rows).

**`search_after` is declared but completely inert**, on both paths. It was probed with the
correct sort value (`[10358]`), the `_instance_id` string, a two-element tuple, an empty array,
and outright garbage (`["total-garbage"]`). Every one returned the same first page, and none
raised — the parameter is accepted by the schema and then ignored. No response on either path
carries a cursor field.

The likely reason is visible in the REST envelope: `search_from_index: false`. `search_after` is
an index-style cursor, and this cluster has no built indexes at all — a scan of 200 resources
found zero with an `index_config` or `index_name`, and the `order` object type's backing
resource reports `index_config: {}` against a live Postgres table. So the cursor could not be
confirmed on an indexed object type, because none exists here to test against.

`iterate()` therefore pages with `limit`/`offset`. Since paging is entirely inside the runtime,
adopting a cursor later needs no regeneration — and `search_from_index` is the flag that tells
the runtime whether it is even worth trying.

### Ordering

**REST accepts `sort`; the MCP tool has no ordering at all.**

```json
{"sort": [{"field": "order_id", "direction": "desc"}]}
```

That returned 28356, 28355, 28354 against a default ascending 10357, 10358, 10359. Two plausible
spellings — `order_by: [{property, direction}]` (the shape `query_metric` uses) and
`orders: [{field, order}]` — were **silently ignored** rather than rejected. Silent acceptance of
an unknown key is the dangerous behavior here: a wrong spelling produces unsorted results with
no error, so the runtime emits exactly `sort` and never forwards user-supplied sort dicts.

### Counting

**`count()` is supported, on REST, via `need_total: true`** — and the total respects the filter:

| Query | `total_count` |
| --- | --- |
| no condition | 15000 |
| `order_status == "pending_payment"` | 1746 |

The MCP tool does not accept `need_total` and returns no total under any argument, which is the
second reason REST is the default path. This reverses an earlier draft that dropped `count()`
from the release.

### Response shape

```json
{"datas":[{"order_id":10357,"order_no":"2026070720DC7170D9C74799","total_amount":"14485.37",
  "_instance_id":"order-10357","_instance_identity":{"order_id":10357},"_display":"2026…"}]}
```

Instances are flat — properties sit at the top level, not nested under `properties`. Three
reserved keys accompany them: `_instance_id`, `_instance_identity` (the primary-key map), and
`_display` (the display-key value, `null` when that property was not selected). The generator
maps these to `__instance_id__`, `__identity__`, and `__display__` on the instance so they cannot
collide with a real property named `id`.

`response_format` **defaults to `toon`**, a compact text format. The runtime always sends
`"json"` explicitly.

Two decoding details the type mapping depends on:

- `decimal` arrives as a **JSON string** (`"14485.37"`), so `Decimal(str)` is both correct and
  lossless — the mapping to `decimal.Decimal` is validated, and float would have been wrong.
- `datetime` arrives ISO 8601 with offset (`2026-07-07T21:14:17.891674+08:00`), parsed by
  `datetime.fromisoformat`.

### Every read is a traced operation

Each `tools/call` returns a `bkn_receipt` alongside the result: `operation_id`, `operation_key`,
`normalized_input_hash`, `payload_hash`, `observed_evidence_refs`, and `business_refs` resolved
down to property granularity (`property:ecommerce_ops_bkn_public:order:order_id`).

This is a genuine differentiator over a plain REST client and it is why the lifecycle session is
mandatory rather than incidental: reads through this SDK are evidence-chain operations. The
runtime keeps the receipt available on the result (`result.receipt`) rather than discarding it,
since the agent audience is exactly the audience that needs to cite its sources.

### Relation traversal

`query_instance_subgraph` takes `relation_type_paths[]`, each with `object_types[]` steps that
carry their own `condition` (same grammar, minus `knn`) and a per-path `limit`. That is the
backing for `b.material.take(100)`.

### Remaining unknowns

Small and non-blocking:

- Whether `search_after` works on other deploys, or requires a sort context that this tool does
  not expose.
- Whether any deploy returns a total, which would restore `count()`.
- Whether `knn` requires the property to carry a built vector index (almost certainly yes — it
  should surface as a typed error rather than an empty result).
