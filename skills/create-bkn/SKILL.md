---
name: create-bkn
description: >-
  Guides creation of BKN (Business Knowledge Network) definition files following the BKN 3.0 spec.
  Covers network, value_type, object_type, relation_type, action_type, concept_group, including
  property declarations (semantic, required, constraints), value types and enums, aliases, relation
  declarations (reverse name, cardinality, constraints, relation properties), lifecycle and
  fallback paths. Use when creating knowledge networks, BKN files, object types, relation types,
  action types, value types, concept groups, or when user asks to model business knowledge in BKN format.
  When the openbkn skill is also loaded, use it to run the openbkn CLI (auth, bkn push) after files exist.
---

# Create BKN

Generate well-formed BKN 3.0 directories (Markdown + YAML frontmatter).

## Works with the openbkn skill

**create-bkn** authors the `.bkn` tree; the **openbkn** skill runs `openbkn auth login` and `openbkn bkn push` / `pull` after files exist.

## What is BKN

BKN is Markdown + YAML frontmatter for schema; one file per definition under typed subfolders. Details (sections, required tables, types, every declaration) live in [references/SPECIFICATION.llm.md](references/SPECIFICATION.llm.md).

## Spec version

Write BKN 3.0: put `bkn_spec: "3.0"` in `network.bkn`. Without it the package is read as 2.x and every 3.0 declaration (semantic, required, constraints, value types, aliases, relation declarations, lifecycle) is ignored.

- 3.0 accepts **one way to write each thing**. Unknown frontmatter fields, unknown `###` sections, unknown or legacy columns and wrappers are rejected on push with the file and position. Write only what the spec lists.
- Stay on 2.x (no `bkn_spec`, no 3.0 declarations) only when the target platform is older than 0.2.1. [references/examples/k8s-network/](references/examples/k8s-network/) is a 2.x package; do not copy its frontmatter fields, `condition:` wrapper or extra sections into a 3.0 package.

## Directory layout

```
{network_dir}/
├── SKILL.md
├── network.bkn
├── CHECKSUM                 # optional; generated on export
├── value_types/             # 3.0: enums, formats, ranges reused by properties
├── object_types/
├── relation_types/
├── action_types/
├── risk_types/
└── concept_groups/
```

## Workflow

1. **Gather requirements** — objects and their key properties, relations (and which ones are reliable), actions, code tables / dictionaries, optional concept groups
2. **Read spec** — [references/SPECIFICATION.llm.md](references/SPECIFICATION.llm.md) (format rules, sections, declarations)
3. **Pick templates** — copy/adapt from [assets/templates/](assets/templates/)
4. **Create `network.bkn`** — root file with `bkn_spec: "3.0"`; title and network description only
5. **Create `value_types/*.bkn`** — one per code table (enum), fixed format (pattern / length) or bounded number (range / unit) that properties share
6. **Create `object_types/*.bkn`** — one file per object, `{id}.bkn`; declare semantic, required, aliases and constraints
7. **Create `relation_types/*.bkn`** — one file per relation; declare reverse name, cardinality, constraints; mark helper relations `secondary` and link fallback paths with `fallback_for`
8. **Create `action_types/*.bkn`** — one file per action
9. **Create `concept_groups/*.bkn`** — optional
10. **Add root `SKILL.md` in the BKN directory** — same folder as `network.bkn` (this is **not** the create-bkn skill file); agent-facing guide for that network (see [Delivered BKN: root SKILL.md](#delivered-bkn-root-skillmd))
11. **Review (MUST)** — cross-check [Validation checklist](#validation-checklist) and [Business rules placement](#business-rules-placement); fix IDs, cross-refs, headings
12. **Validate (MUST)** — `openbkn bkn validate <dir>` (see [Validation](#validation))
13. **Import** (optional) — `openbkn bkn push <dir>`

## Import (openbkn CLI)

Requires the `openbkn` CLI from `@openbkn/bkn-sdk` (`npm install -g @openbkn/bkn-sdk`; Node.js 22.19.0+). `push` uses `tar`; on macOS `COPYFILE_DISABLE=1` is set by the tool.

- **Platform auth** — Don't pre-check with `openbkn auth status`; run `openbkn bkn push` directly (`validate` is offline and needs no login). Only when it fails with 401 / not authorized, run `openbkn auth login <platform-url>` and retry.
- **BKN validation** — If workflow step 12 (`openbkn bkn validate <dir>`) **already succeeded** for this directory, **do not** repeat validate before `push` unless you changed `.bkn` files. If you have **not** validated yet, run `validate` before `push`.
- **3.0 rules** — the platform checks the 3.0 rules on push and names the file, section and field of each problem. Fix the file and push again.
- **Tools** — every toolbox or MCP tool an action or logic property references must exist on the target platform, or push fails listing the missing tools. To import the model without them, push with `--binding-policy detach` and bind the tools on the platform afterwards.

```bash
openbkn bkn push <dir> [--branch main] [--binding-policy detach]
```

Export: `openbkn bkn pull <kn-id> [<dir>]`. More subcommands: `openbkn bkn --help` (see the openbkn skill if loaded).

## Validation

`openbkn bkn validate <dir>` — must pass before delivery or upload. It is an offline structural check: it loads `network.bkn` and sibling `.bkn` files, checks frontmatter, ids, table shape and relation endpoints, and prints counts (object types, relation types, concept groups, value types). The 3.0 declaration rules are checked by the platform on push; follow the spec to get them right the first time.

A `capabilities:` section in `network.bkn` never fails validation. Read `capabilities.skipped` and the warnings instead: an entry listed there binds on no platform. After `push`, the answer's `capabilities.skipped` names what this platform could not resolve.

## Per-type reference

| Kind | Template | Example (clinic-lab) |
|------|----------|----------------------|
| Network | [network_type.bkn.template](assets/templates/network_type.bkn.template) | [network.bkn](references/examples/clinic-lab/network.bkn) |
| Value type | [value_type.bkn.template](assets/templates/value_type.bkn.template) | [lis_apply_status.bkn](references/examples/clinic-lab/value_types/lis_apply_status.bkn) (enum), [cn_id_card.bkn](references/examples/clinic-lab/value_types/cn_id_card.bkn) (format), [amount_cny.bkn](references/examples/clinic-lab/value_types/amount_cny.bkn) (range) |
| Object | [object_type.bkn.template](assets/templates/object_type.bkn.template) | [lab_order.bkn](references/examples/clinic-lab/object_types/lab_order.bkn), [patient.bkn](references/examples/clinic-lab/object_types/patient.bkn) |
| Relation (direct) | [relation_type.bkn.template](assets/templates/relation_type.bkn.template) | [order_for_patient.bkn](references/examples/clinic-lab/relation_types/order_for_patient.bkn), [department_under.bkn](references/examples/clinic-lab/relation_types/department_under.bkn) (self, transitive) |
| Relation (indirect, with properties) | [relation_type_indirect.bkn.template](assets/templates/relation_type_indirect.bkn.template) | [doctor_in_department.bkn](references/examples/clinic-lab/relation_types/doctor_in_department.bkn) |
| Fallback path / lifecycle | — | [order_for_patient_by_id_card.bkn](references/examples/clinic-lab/relation_types/order_for_patient_by_id_card.bkn), [order_by_legacy_doctor.bkn](references/examples/clinic-lab/relation_types/order_by_legacy_doctor.bkn) |
| Action | [action_type.bkn.template](assets/templates/action_type.bkn.template) | [revoke_lab_order.bkn](references/examples/clinic-lab/action_types/revoke_lab_order.bkn) |
| Concept group | [concept_group.bkn.template](assets/templates/concept_group.bkn.template) | [lab.bkn](references/examples/clinic-lab/concept_groups/lab.bkn) |

Templates are complete 3.0 files: replace every `{placeholder}`, and delete rows, columns, keys or sections you do not need (a column no property uses, such as `Semantic` or `Aliases`, is left out whole). Full rules and optional sections: [references/SPECIFICATION.llm.md](references/SPECIFICATION.llm.md).

## Declarations: when to use what

- **Code table / dictionary** (status codes, department codes) → enum value type, referenced with `value_type`. Keep retired codes with `deprecated: true`: stored data still holds them.
- **Shared format or range** (ID card number, amount ≥ 0) → format / range value type. A property that references a value type writes no `range` / `length` / `pattern` / `unit` of its own.
- **One-off constraint** → inline in `### Property Constraints`.
- **Time and place** → `Semantic` (`event_time`, `end_time`, `valid_from`, `valid_to`, `location`, `latitude` / `longitude`), plus `timezone` / `crs` when known.
- **Other names users call it** → `aliases` (definitions) and the `Aliases` column (properties).
- **Relations** → `reverse_name` when the reverse reads differently; `Cardinality` whenever known; `required` for "every X has a Y"; `verification: unconfirmed` for inferred links; `importance: secondary` + `fallback_for` for a path that fills gaps of a primary relation.
- **Retiring a definition** → `lifecycle: { status: deprecated, reason, replaced_by }`, never a name prefix like "【废弃】".

## Naming conventions

- **ID**: lowercase, digits, underscores; **file**: `{id}.bkn` under the matching folder
- **Headings**: `#` network title, `##` definition (`## ObjectType: {name}`, `## ValueType: {name}`, …), `###` section, `####` logic property
- **Frontmatter**: `type`, `id`, `name`, plus only the fields the spec lists for that type

## Business rules placement

Rules must sit in spec-defined places so import persists them. Full wording: [references/SPECIFICATION.llm.md](references/SPECIFICATION.llm.md#业务规则放在哪里).

- **Network-level** — prose in `network.bkn` right after `# {title}`
- **Type-level** — prose in each type file after `## ObjectType:` / `## RelationType:` / … and **before** the first `###`; never in frontmatter
- **Property-level** — what a declaration can say (semantic, required, unit, enum, format, range) goes in the declaration; the **Description** column keeps only business meaning, calculation and caveats
- **No extra sections** — 3.0 rejects unknown `###` sections and frontmatter fields

## Validation checklist

- [ ] `network.bkn` at root with `bkn_spec: "3.0"`; body is only the title and description
- [ ] Every `.bkn` has valid YAML frontmatter (`type`, `id`, `name`) and no fields outside the spec
- [ ] Files live under folders matching `type` (`value_types/`, `object_types/`, …); filename = `{id}.bkn`; `## {Prefix}: {name}` matches `name`
- [ ] Relations, actions, concept groups, `value_type`, `fallback_for` and `replaced_by` reference ids defined in the package
- [ ] `Semantic` values fit the property `Type` and appear at most once per definition; `end_time` has an `event_time`; `latitude` / `longitude` come in pairs
- [ ] Primary keys leave `Required` empty; no `Required: false`, `importance: primary` or `lifecycle.status: active` written out
- [ ] A property with `value_type` has no `range` / `length` / `pattern` / `unit`
- [ ] Parameter tables put `property` | `input` | `const` in `ValueFrom`, the property name or constant in `Value`, and the request position (`Query` / `Body` / …) in `Source`
- [ ] Condition YAML is written directly (no `condition:` wrapper); every YAML block parses
- [ ] Heading hierarchy has no skipped levels; no HTML comments or notes left inside sections
- [ ] Business rules only in allowed places (see [Business rules placement](#business-rules-placement))

## Output rules

1. Emit raw `.bkn` content — do not wrap the whole file in a fenced `markdown` block
2. Reuse IDs consistently across relations/actions/value types
3. IDs: lowercase + underscores; display text Chinese unless asked otherwise
4. Keep heading order and column names per spec

## Examples

- [references/examples/clinic-lab/](references/examples/clinic-lab/) — BKN 3.0: value types, property declarations, aliases, relation declarations and properties, lifecycle, fallback path, action, concept group
- [references/examples/k8s-network/](references/examples/k8s-network/) — BKN 2.x package, kept for platforms older than 0.2.1

## Delivered BKN: root SKILL.md

When you build a knowledge network directory `{network_dir}/`, add `{network_dir}/SKILL.md` at the root (alongside `network.bkn`). Short overview + **index tables with file paths** (value type | object | relation | action | path) so agents route to the right `.bkn` without scanning, and how to use the declarations (enum codes, fallback paths, deprecated definitions). Example: [references/examples/clinic-lab/SKILL.md](references/examples/clinic-lab/SKILL.md).
