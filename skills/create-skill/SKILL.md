---
name: create-skill
description: >-
  Guides authoring of an OpenBKN Skill package (SKILL.md + references) that declares which
  knowledge-network capabilities it uses — metrics, functions, actions, MCP tools — so an agent
  reading it knows what to call, how, and which steps need user confirmation. Also covers writing
  a sandbox function with bkn-osdk and registering it as a tool. Use when creating a skill,
  writing SKILL.md for the execution factory, declaring capability dependencies, or turning
  Python code into a function tool. When the openbkn skill is loaded, use it for
  `openbkn skill register` / `tool create` after files exist.
---

# Create Skill

Author a Skill package the execution factory can register and an agent can follow. No platform
code is involved: the agent already has `get_skill_content`, `search_capabilities`,
`get_kn_detail`, `query_metric`, `execute_tool` and `execute_action`; the Skill's job is to say
**which** capabilities to use and **how**.

## Works with the openbkn skill

**create-skill** writes the files; the **openbkn** skill runs `openbkn skill register`,
`openbkn skill set-status`, `openbkn function run`, `openbkn tool create` once they exist.
[create-bkn](../create-bkn/SKILL.md) models the network itself — a Skill assumes the network,
its metrics and its actions already exist.

## Package layout

```
{skill_dir}/
├── SKILL.md                 # required; frontmatter name + description (+ metadata.uses)
└── references/              # optional: report format, business rules, IO contract
    └── report-spec.md
```

The execution factory parses only frontmatter `name`, `description` and `metadata` (free-form,
stored as-is). The body is prose the agent reads — the "capability dependencies" table below is
a convention, not a schema.

## Workflow

1. **Fix the scope** — one knowledge network (`bkn_scope`). List the user questions that
   trigger this skill and the parameters the agent must obtain from the user.
2. **Pick capabilities by name** — metrics and action types from `get_kn_detail` /
   `get_object_types`, functions and MCP tools from `search_capabilities`. Use the registered
   names verbatim; the agent searches by name.
3. **Declare them twice** — machine-readable in frontmatter `metadata.uses[]`
   (`type`, `name`, `purpose`, `confirm`), and for the agent in the body table
   (name | type | purpose | how to call | how to read the result | confirmation).
4. **Write the steps** — numbered, one platform call per step, with parameter mapping between
   steps. Say which step ends early on a good result and which step must ask the user first.
5. **Mark confirmations** — any action with side effects gets `confirm: true` and the sentence
   "do not execute without an explicit yes". The platform does not gate this; the skill does.
6. **Add `references/report-spec.md`** — the output shape, including the "依据" line naming the
   capabilities used so the user can check the trace.
7. **Register, publish, mount** — see [Delivery](#delivery). A skill is only visible to an
   agent inside networks it is mounted on.
8. **Verify end-to-end** — one managed interaction should show `get_skill_content` →
   `query_metric` → `execute_tool` → `execute_action` under the same `interaction_id`, and
   `bkn_finish_interaction` should return `evidence_status: complete`.

Template: [assets/templates/SKILL.md.template](assets/templates/SKILL.md.template) ·
[assets/templates/report-spec.md.template](assets/templates/report-spec.md.template).
Worked example (verified on a 0.1.5 deploy):
[references/examples/demand-deliverability-assessment/](references/examples/demand-deliverability-assessment/).

## Writing rules

- **Names are lookup keys.** A misspelled name means the agent cannot find the capability.
- **Only mounted capabilities.** Tell the agent to report "not mounted" rather than fall back to
  a same-named capability in another network or the platform catalog.
- **Text fields locate with `match`.** Fields carrying a full-text index (`condition_operations`
  contains `match`) may reject `==` at the resource layer; say so in the step that locates rows.
- **Finding skills:** `search_capabilities` with a query ranks functions first; pass
  `types: ["skill"]` when the goal is the skill itself.
- **No secrets, no URLs.** A skill names capabilities; the platform carries credentials and the
  managed turn.

## Functions (bkn-osdk)

A function is Python that runs in the platform sandbox and is registered as a tool. The sandbox
ships `bkn_osdk` and injects `BKN_BASE_URL`, `BKN_TOKEN`, `BKN_CONVERSATION_ID`,
`BKN_INTERACTION_ID` and `BKN_PARENT_OPERATION_ID`, so the code configures nothing:

```python
from bkn_osdk import kn

def handler(event):
    rows = kn.query_object_instance(event["kn_id"], "order", limit=500,
                                    filters=[{"field": "status", "op": "==", "value": "paid"}],
                                    properties=["order_no", "amount"], response_format="json")
    return {"count": len(rows.get("datas") or [])}
```

Hard rules, all verified against a live sandbox:

1. The entry point must be `handler(event)`; `event` is the tool's input object.
2. No `from __future__ import ...` — the sandbox prepends a wrapper and the import becomes a
   `SyntaxError`.
3. Tool parameter `type` is one of `string` / `number` / `boolean` / `array` / `object`;
   `integer` is rejected with 400.
4. Reads made through bkn-osdk inside the function land on the caller's interaction as children
   of the `execute_tool` operation — no extra wiring.

Skeleton: [assets/templates/function.py.template](assets/templates/function.py.template).
Full example (BOM level-1 kitting check):
[references/examples/functions/l1_kitting_check.py](references/examples/functions/l1_kitting_check.py).
Details of `kn.query_metric` / `kn.run_sql` and the generated ontology layer: the bkn-osdk
README under `python/`.

### Calling another function

A function may call another function mounted on the same network through the platform:

```python
from bkn_osdk import kn

def handler(event):
    answer = kn.execute_tool(event["kn_id"], event["box_id"], event["tool_id"],
                             {"kn_id": event["kn_id"], "product": event["product"], "qty": 50})
    body = answer.get("body", answer)           # the callee's raw response
    if body.get("exit_code") not in (0, None):  # HTTP 200 does not mean the callee succeeded
        return {"ok": False, "reason": body.get("stderr", "")[-300:]}
    return {"ok": True, **(body.get("result") or {})}
```

- `kn.execute_tool` carries the sandbox's managed turn, so the callee's sandbox gets the same
  caller credential and the trace shows the callee under this function's `execute_tool`
  operation, with the callee's own reads below it.
- Needs a sandbox bkn-osdk that has `kn.execute_tool` (bkn-sdk #100 or later). On an older
  SDK the only route is `bkn_osdk.call("/api/agent-retrieval/v1/kn/execute_tool", ...)`, and
  the request body **must** carry a `bkn_context` built from `BKN_CONVERSATION_ID`,
  `BKN_INTERACTION_ID` and `BKN_PARENT_OPERATION_ID`; without it the callee's sandbox is
  given no credential at all.
- The callee's own mounting and permissions apply. There is no depth or cycle guard — do not
  write functions that call each other.

Example: [references/examples/functions/call_l1_check.py](references/examples/functions/call_l1_check.py).

### Code → tool (openbkn CLI 0.1.5+)

```bash
openbkn function run ./fn.py --event '{"kn_id":"<kn>","product":"P1","qty":50}' --pass-token
openbkn toolbox create --name my_functions --type function     # name: letters, digits, _, CJK
openbkn tool create ./fn.py --toolbox <box-id> --name fn \
    --description "..." \
    --inputs '[{"name":"kn_id","type":"string","required":true}]' \
    --outputs '[{"name":"kitting_ok","type":"boolean"}]'
openbkn tool enable <tool-id> --toolbox <box-id>              # tools start disabled
openbkn toolbox publish <box-id>
```

Mount the tool on the network (CLI subcommand pending bkn-sdk #90; the REST call works today):

```bash
openbkn call -X POST /api/bkn-backend/v1/knowledge-networks/<kn>/capabilities \
  -d '{"capabilities":[{"capability_type":"function","box_id":"<box-id>","capability_id":"<tool-id>"}]}'
```

## Delivery

```bash
openbkn skill register ./{skill_dir}          # -> skill_id, status unpublish
openbkn skill set-status <skill_id> published
openbkn call -X POST /api/bkn-backend/v1/knowledge-networks/<kn>/capabilities \
  -d '{"capabilities":[{"capability_type":"skill","capability_id":"<skill_id>"}]}'
```

## Validation checklist

- [ ] Frontmatter has `name`, `description`, `metadata.bkn_scope`, `metadata.uses[]`
- [ ] Every name in `uses[]` also appears in the body table, spelled identically
- [ ] Every capability is mounted on `bkn_scope` (check with `search_capabilities` /
      `get_kn_detail`)
- [ ] Each action with side effects has `confirm: true` and a "do not execute without an
      explicit yes" step
- [ ] Steps map outputs of one call to inputs of the next explicitly
- [ ] `references/report-spec.md` ends with the capabilities used, for trace cross-checking
- [ ] Function code: `handler(event)`, no `__future__` import, parameter types from the allowed set
