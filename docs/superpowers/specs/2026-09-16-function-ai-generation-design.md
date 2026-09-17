# Execution Capability Command Model and Function AI Generation Design

## Goal

Make the CLI distinguish a temporary code workspace from a registered capability that can be managed and executed through a Toolbox. The command name must tell an operator whether it is dealing with sandbox code, a persisted Function Tool, or a persisted OpenAPI Tool.

This design also retains the Function AI-generation endpoints added in this change set, but moves their CLI entry from `function` to `sandbox` so the command hierarchy matches that distinction.

## Command model

| Command group | Meaning | Backing surface |
| --- | --- | --- |
| `sandbox` | Temporary code and its generated artifacts. | Existing Function sandbox and AI-generation APIs. |
| `function` | A registered Function Tool in a Toolbox. | Existing Toolbox/Tool API with `metadata_type=function`. |
| `api` | A registered OpenAPI Tool in a Toolbox. | Existing Toolbox/Tool API with `metadata_type=openapi`. |
| `toolbox` | The container and its publication lifecycle. | Existing Toolbox API. |
| `tool` | Advanced, type-neutral Toolbox/Tool access retained for compatibility. | Existing Toolbox/Tool API. |

`mcp` remains a separate future read-only command group. MCP Market, Operator, Sandbox administration, BKN Agent, and Ontology Query remain out of scope.

## Sandbox commands

`openbkn sandbox` owns the current temporary-code workflow:

- `run`, `infer-schema`, `deps`, `versions`, and `template` keep their current behavior.
- `generate <type>` and `prompt <type>` move here from the temporary `function` CLI group.

The AI transport surface remains `POST /api/agent-operator-integration/v1/ai_generate/function/{type}` and `GET /api/agent-operator-integration/v1/ai_generate/prompt/{type}`. `client.functions.generate` and `client.functions.promptTemplate` remain available programmatically; the change is a CLI naming correction, not a removal of the SDK API.

`generate` accepts exactly one type-specific input mode: `--query` for `python_function_generator`, or `--code <file>` for `metadata_param_generator`, plus optional JSON `--inputs` and `--outputs`. Streaming generation remains rejected by the SDK until an SSE result contract is implemented.

## Registered capability facades

`openbkn function` provides a Function Tool-oriented facade over the generic Toolbox API. Its commands use `--toolbox <id>` wherever the target container is required and always set or validate `metadata_type=function`:

```text
openbkn function create <file> --toolbox <id>
openbkn function list --toolbox <id>
openbkn function get <tool-id> --toolbox <id>
openbkn function update <tool-id> --toolbox <id> ...
openbkn function delete <tool-id> --toolbox <id>
openbkn function enable|disable <tool-id> --toolbox <id>
openbkn function execute|debug <tool-id> --toolbox <id> ...
```

`openbkn api` provides the equivalent OpenAPI Tool facade. It uses `metadata_type=openapi` and names its file-based onboarding command `import` to describe what the user supplies:

```text
openbkn api import <file> --toolbox <id>
openbkn api list --toolbox <id>
openbkn api get <tool-id> --toolbox <id>
openbkn api update <tool-id> --toolbox <id> ...
openbkn api delete <tool-id> --toolbox <id>
openbkn api enable|disable <tool-id> --toolbox <id>
openbkn api execute|debug <tool-id> --toolbox <id> ...
```

The facades reuse the validated file parsing, request mapping, resource methods, output formatting, dry-run handling, and errors already implemented by `tool`. They do not add a second HTTP client or a different persisted object model. `tool` stays available for mixed-type or low-level workflows, so existing automation remains valid.

The programmatic persistent-tool surface remains `client.toolboxes`, whose generic methods intentionally expose both tool types. Typed CLI groups improve discoverability without duplicating that SDK API.

## Help and documentation

Root help, grouped-help classification, `openbkn describe`, ID-source metadata, the Toolbox/Tool product specification, and the OpenBKN skill reference will explain the ownership boundary and point users to the right workflow:

1. use `sandbox` to test or generate code;
2. create or select a `toolbox`;
3. import a persistent `function` or `api` capability into that toolbox;
4. debug it, enable it, publish the toolbox, then execute it (`execute` requires a published toolbox).

Each command description names the user-facing capability it manages rather than the generic backend Tool resource. The new facade commands preserve the existing READ/RUN/WRITE help sections and probe service mapping.

## Compatibility and migration

The root `function` name is reassigned from temporary sandbox operations to registered Function Tools. Documentation will direct users of `function run`, `function generate`, and the other former temporary-code commands to `sandbox`. No silent command alias is added because it would leave the ambiguous hierarchy in place.

`tool` and `toolbox` retain their public behavior and scripts using them continue to work. This change does not alter persisted Toolbox or Tool data, endpoint contracts, or metadata schemas.

## Verification

- Unit tests cover the sandbox command relocation, Function/OpenAPI type enforcement, delegated request mapping, help classification, describe metadata, and migration-facing help text.
- Run lint, build, focused tests, and the full unit suite.
- On 14.103.77.23, perform read-only checks of sandbox prompt retrieval and Toolbox/Tool listing and detail requests for both types. Do not invoke AI generation or alter existing Toolbox/Tool data.
