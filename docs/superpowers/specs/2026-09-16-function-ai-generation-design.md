# Function AI Generation API Design

## Scope

Complete the two public Function endpoints that the SDK does not yet expose:

- `POST /api/agent-operator-integration/v1/ai_generate/function/{type}`
- `GET /api/agent-operator-integration/v1/ai_generate/prompt/{type}`

The existing sandbox execution, schema inference, dependency, and template APIs remain unchanged. Sandbox administration, Operator, BKN Agent, and Ontology Query are out of scope.

## API surface

`api/functions.ts` adds two transport functions:

- `generateFunction(ctx, type, request)` posts the documented request body. `type` is `python_function_generator` or `metadata_param_generator`; the body remains a forward-compatible object because each type requires a different field and the platform may add generation options.
- `getFunctionPromptTemplate(ctx, type)` reads the prompt template used for the same generation type.

The generation request accepts `stream`; this initial API exposes the documented non-streaming JSON response. A streaming request is rejected at the SDK boundary with an `InputError` directing callers to the raw `call` command until an SSE result contract is specified. This avoids returning an unread stream as `unknown` and falsely presenting it as a completed generation result.

`resources/functions.ts` exposes both operations through `client.functions.generate` and `client.functions.promptTemplate`.

## CLI

`openbkn function generate <type>` accepts exactly one input mode:

- `--query <text>` for `python_function_generator`.
- `--code <file>` for `metadata_param_generator`; the file contents become the wire `code` field.

It accepts optional JSON `--inputs` and `--outputs`, mapped to the documented parameter definitions. `openbkn function prompt <type>` reads the corresponding template. The commands are classified as RUN: generation invokes the platform model but stores no component configuration.

## Validation and errors

The CLI validates type-specific required input before opening a network request. The resource rejects `stream: true` for the initial non-streaming API. Server errors, including upstream model authentication, rate-limit, and availability failures, propagate as the existing HTTP error type without being recast as user input errors.

## Verification

- Unit tests assert the URL encoding, GET/POST method, request-body mapping, streaming guard, CLI file-to-code conversion, invalid type/input combinations, and help classification.
- Run lint, build, the focused tests, and the full unit suite.
- On 14.103.77.23, read the prompt template. A generation request would invoke an external model and is not sent unless explicitly authorized; transport behavior is covered by unit tests.
