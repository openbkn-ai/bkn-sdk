# Python OSDK implementation plan

Design: [../specs/2026-08-11-python-osdk-design.md](../specs/2026-08-11-python-osdk-design.md)

Ten phases in dependency order. Each lands something independently verifiable, so a phase can
be reviewed and merged before the next begins. Phases 1–3 have no dependency on the generator,
and phase 4 has none on the runtime — they can proceed in parallel if two people work on this.

## 1. Package skeleton and credential resolution

1. Create `python/` with `pyproject.toml` (`bkn-osdk`, runtime dependency `httpx` only, console
   script `bkn-osdk = bkn_osdk.codegen.cli:main`), ruff and mypy configuration, `py.typed`.
2. Implement `config.py`: `configure()`, the `session()` context manager over a
   `contextvars.ContextVar`, and the four-level resolution chain — scope, process default,
   `BKN_TOKEN`/`BKN_BASE_URL`, then `~/.bkn/platforms/<base64url(baseUrl)>/users/<userId>/token.json`.
3. Port the store layout reader only — the Python side never writes tokens; `openbkn auth login`
   owns that file.
4. Tests: resolution precedence, and **concurrent tasks under different scopes each send their
   own token** (the cross-tenant leak test the design calls out).

## 2. HTTP client and errors

1. `http.py` over `httpx`: timeouts, JSON in/out, `X-HTTP-Method-Override` support, TLS-insecure
   opt-in matching the CLI's `-k`.
2. `errors.py`: `HttpError` carrying status plus the next-step hints from
   [`api/http.ts:88-131`](../../../src/api/http.ts#L88-L131) (AppKey-401, lifecycle), `InputError`,
   `ToolError` (structured `code` / `required_action` / `retryable` / `retry_after_ms`),
   `SchemaDriftError`, `FormatVersionError`, `ObjectNotFound`.
3. `call()` — the generic authenticated escape hatch.
4. Tests against recorded fixtures in the repo-root `fixtures/`, shared with the TypeScript side.

## 3. Schema fetch and models

1. `schema.py`: fetch network metadata, object types, and relation types from ontology-manager
   REST (`branch`, `limit=-1`), and parse into frozen dataclasses — `KnSchema`, `ObjectTypeDef`,
   `PropertyDef`, `RelationTypeDef`.
2. Capture the real responses from the live KN `ecommerce_ops_bkn_public` into
   `python/tests/fixtures/schema/` as the generator's input fixtures.
3. Compute `SCHEMA_FINGERPRINT`: a stable hash over object/relation type ids, property names, and
   property types, with sorted iteration so it never depends on dict order.
4. Deliberately ignore `condition_operations` — the design records why it is advisory.

## 4. Generator core (pure)

1. `codegen/emit.py`: `generate(schema, options) -> dict[str, str]`. No IO, no HTTP, plain string
   templates, fixed key order.
2. Emit `__init__.py` (registries, `KN_ID`, `BRANCH`), `object_types.py`, `relation_types.py`,
   `_meta.py` (`SCHEMA_FINGERPRINT`, `FORMAT_VERSION`, `REQUIRES_RUNTIME`, `GENERATED_BY`).
3. Naming: id → PascalCase class, keyword suffixing, and **hard failure on class-name collision**
   listing both offending ids.
4. Type mapping per the design's table, including `decimal → Decimal` and the pass-through of
   non-standard types to `Any`.
5. Golden-file tests: fixture schema in, committed tree out, byte-for-byte. Include a collision
   fixture and a keyword-id fixture as expected failures.
6. Regenerating an unchanged schema must produce an identical tree — assert it explicitly, since
   the whole upgrade story rests on it.

## 5. Runtime base classes

1. `types.py`: `ObjectType`, `Property[T]`, `Relation[T]`.
2. The descriptor split — `Property.__get__` returns a `PropertyRef` when `obj is None` and the
   deserialized value otherwise.
3. Comparison operators on `PropertyRef` building `Filter` nodes; `&` and `|` composing them;
   `.asc()` / `.desc()`; `.is_in()`, `.like()`, `.exists()`, `.near(vec, k=…)`.
4. Deserialization: flat properties, `_instance_id` / `_instance_identity` / `_display` mapped to
   `__instance_id__` / `__identity__` / `__display__`, `Decimal(str)`, `datetime.fromisoformat`.
5. Tests: generate a package from the fixture schema, then run `mypy --strict` over it and assert
   `People.name` is a `PropertyRef[str]` while `p.name` is a `str`.

## 6. Query execution over REST

1. `query.py`: `Filter` → the recursive `condition` tree (`operation` / `field` / `value` /
   `value_from: "const"` / `sub_conditions`).
2. `ObjectSet` with `where`, `order_by`, `take`, `iterate`, `count`, `get`, and `raw(dict)`.
3. REST transport: `POST /api/ontology-query/v1/knowledge-networks/{kn}/object-types/{ot}` with
   `X-HTTP-Method-Override: GET`; `need_total: true` only when `count()` is called; **emit `sort`
   and only `sort`** — never forward a user-supplied ordering dict, since unknown keys are
   silently ignored rather than rejected.
4. `iterate()` pages with `limit`/`offset`. Do not implement `search_after`; record
   `search_from_index` from the response so a later cursor implementation has its trigger.
5. `get(pk)` builds an equality condition over `__primary_key__`, supporting composite keys.
6. Tests against recorded fixtures covering: flat condition, nested `and`/`or`, `in`, property
   selection, offset paging, `need_total` with and without a filter.

## 7. Lifecycle sessions and the traced path

1. `lifecycle.py`: open an interaction via `bkn_start_interaction`, reuse it for the lifetime of
   the enclosing `session(...)` scope, finish it on exit.
2. `mcp.py`: MCP transport — `tools/call`, `bkn_context` injection, receipt extraction.
3. `session(traced=True)` routes reads through MCP; results expose `.receipt`.
4. REST responses carrying `conversation_required` open a session and retry **once**, so a deploy
   that enforces the lifecycle contract works unchanged.
5. Tests: session reuse across several queries in one scope, finish-on-exit including on
   exception, and the retry-once path.

## 8. Relation traversal

1. Emit `Relation` attributes from relation types, with the endpoint ids and mapping rules.
2. Instance-level traversal returning a typed `ObjectSet` backed by `query_instance_subgraph`
   (`relation_type_paths[]`, per-step `condition`, per-path `limit`).
3. Tests against a recorded subgraph response.

## 9. CLI

1. `codegen/cli.py`: `bkn-osdk generate <kn-id> --out --branch --package` and `bkn-osdk check`.
2. Authenticate first; fail with the platform's own message on a bad token. Write nothing unless
   every schema fetch succeeded.
3. Refuse an `--out` directory that exists without a recognisable `_meta.py`.
4. Default `--package` to the KN id; accept non-ASCII overrides.
5. `check`: recompute the fingerprint, exit non-zero on drift, and classify the delta as additive
   or breaking (added/removed/retyped object types and properties).
6. Runtime-side `FORMAT_VERSION` validation at import, supporting the current version and the one
   before it, with a regenerate instruction in the error.
7. Tests: golden CLI output, exit codes, and the refusal paths.

## 10. Integration, CI, and documentation

1. End-to-end test against the live VM, gated on credentials being present: generate a package
   from `ecommerce_ops_bkn_public`, import it, run a filtered query, a sorted query, and a count,
   and assert the numbers observed during design (15000 unfiltered, 1746 for
   `order_status == "pending_payment"`).
2. GitHub Actions job for `python/`: ruff, `mypy --strict`, pytest — alongside `npm run ci`.
3. `python/README.md` — install, generate, query, upgrade.
4. Update root `README.md` and `ARCHITECTURE.md`: the "Python SDK dropped" statements in
   `AGENTS.md:101`, `docs/PRODUCT_SENSE.md:19`, and `docs/design-docs/tech-stack.md:46` are now
   wrong and must be replaced with a pointer to the OSDK and the reason it is a different thing
   from the SDK that was dropped.
5. Add a tech-debt row for each item under the design's *Remaining unknowns*.

## Out of scope

Writes and action execution, generated MCP tool wrappers, generated metrics, an async client,
server-side generation, and offline generation from a `.bkn` directory. Each has a section in the
design describing the shape it takes when it lands.
