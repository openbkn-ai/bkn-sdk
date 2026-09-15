# BKN CLI P0 integrity checks

## Scope and purpose

The requester asked to continue the SDK improvement work after reviewing the
initial reliability fixes. This batch addresses the remaining local CLI P0
failures from the September 14 improvement report. P0-1 is owned here; P0-2
and P0-3 are independent workstreams on table parsing and MCP input validation.

## Push integrity design

The platform's branch-scoped object-type list returns full definitions for
object types visible to the caller. Read it
before and after an explicitly verified `bkn push`; compare `data_source` and
each data property's `condition_operations` by object-type id and property
name. Emit specific warnings for missing bindings, missing object types, and
lost operators. The CLI writes warnings to stderr and preserves the platform's
response on stdout; verified SDK calls also receive an `integrity_warnings`
array in the response object.

Use the existing `listObjectTypes` API with `limit=-1`, not per-item requests.
The backend filters entries by `view_detail` permission before responding;
this comparison cannot prove the state of object types hidden from the caller.
A 404 before upload means the target network/branch does not exist and no
baseline is available. Other unreadable or malformed pre-upload snapshots abort
before the write because they cannot establish a baseline safely. If the
post-upload read fails, return the upload result with an explicit verification
warning; do not claim the bindings survived. This does not retry the upload or
modify platform state beyond the push the caller requested.

`--dry-run` previews the upload request without sending it. Skip integrity
reads for that invocation so a read request does not consume the preview before
the caller sees the intended multipart POST.

An alternative is to compare only local `.bkn` definitions with the remote list.
That cannot detect index operators regenerated or removed by the platform after
import, so the final design reads the live state twice. A separate push-result
wrapper would alter the existing SDK return shape for every caller; verification
is therefore an opt-in SDK option and the default for the CLI.

The report also mentions validating a `ref_property` that names its own field.
That setting belongs to Vega resource `schema_definition`, not to a `.bkn`
definition, so offline `bkn validate` cannot inspect it. This SDK's
`ensureFeature` already writes an empty `ref_property` for in-place indexing,
and the current Vega backend normalizes legacy self-references on original
resources. Dataset resources reject any nonempty `ref_property`. No BKN-file
rule is added for a field the file format does not contain.

## Verification

Mock a network with one bound object type and indexed property, then run a CLI
push that loses them. Assert the exact warnings, branch and request order, and
that an unreadable post-upload snapshot is reported. Mock a new network (404)
and unchanged state to verify no false warning. The `uploadBkn` payload is
never sent when a pre-upload read fails for a reason other than 404.
Exercise `push --dry-run` separately and assert the preview is the POST upload,
with no object-type reads and no network request.

Only mocked requests are authorized here. A live push or repair of damaged
platform data is outside this local code change.
