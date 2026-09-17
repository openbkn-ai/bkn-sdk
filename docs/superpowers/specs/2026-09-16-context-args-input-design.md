# Context argument file input

## Scope

Add safe file and standard-input sources for JSON passed through `--args` on
every `openbkn context` command that currently accepts that option. The change
keeps the SDK and MCP request shapes unchanged.

## Design

- `--args-file <path>` reads UTF-8 JSON from a named file.
- `--args -` reads UTF-8 JSON from standard input. `--args-file -` uses the
  same reader for consistency.
- `--args` and `--args-file` are mutually exclusive. A generic tool or method
  may still combine either JSON source with repeated `--arg key=value`; explicit
  `--arg` values continue to override the parsed object.
- Read failures name stdin or the supplied path without exposing file contents.
  Invalid JSON keeps the existing `--args must be valid JSON` diagnostic. A
  syntactically valid value must still be a JSON object; arrays, scalars, and
  `null` fail before a command can spread or mutate them.
- Parsing continues through `parseBigIntJSON`, so IDs outside JavaScript's safe
  integer range retain their current behavior.

## Verification

Test a file-backed generic MCP tool call, stdin input, mutual exclusion, and
the existing object-instance validation path. Run focused tests, lint, the full
unit suite, build, and a whitespace diff check.
