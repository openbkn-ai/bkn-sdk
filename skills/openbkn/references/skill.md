# skill — registry / market / lifecycle

| Command | Notes |
|---------|-------|
| `list` / `market` / `get <id>` / `market <id>` | Browse registry + market. |
| `names <id...>` | Resolve ids → names in one call; unknown ids are skipped, not an error. |
| `content <id> [--raw] [--draft]` / `read-file <id> <rel-path> [--raw] [--draft]` / `history <id>` | Progressive read + versions. |
| `files <id> [path] [--tree] [--draft]` | File listing. No `path` = root; a directory path = its direct children; `--tree` = whole hierarchy under `path` (or the whole skill when `path` is omitted). |
| `execute <id> --entry '<shell>' [--timeout <s>] [--raw] [--exit-code]` | Run the skill in the platform sandbox. Omit `--timeout` to leave the limit to the sandbox. |
| `set-status <id> <status>` | unpublish \| published \| offline. |
| `register <dir> [--source custom\|internal] [--extend-info <json>]` | Zip a local skill dir → multipart register. SKILL.md must have frontmatter (name/description). `--source` defaults to `custom`, matching the backend's own default (`default:"custom" validate:"oneof=custom internal"`), so the registered result is unchanged from omitting it. |
| `download <id> [out.zip] [--draft]` / `install <id> [dir]` | Save archive / download + unzip. |
| `update-metadata <id> --body <json>` / `update-package <id> <dir>` | Edit metadata / replace package (zip). |
| `republish <id> --version <v>` / `publish-history <id> --version <v>` | Republish / publish a historical version. |

## `--draft` — which version you read

Without it, reads hit the **published release**; with it, the **draft** (current,
possibly unpublished) version. They differ whenever a skill has been edited but
not republished, so pick deliberately. An unpublished skill answers `404 skill
not found` without `--draft`. Permissions differ too: draft reads want
`view`/`modify`, published reads want `execute`/`public_access`/`view`.

## `--raw` — file text instead of a link

`content`/`read-file` return JSON holding a pre-signed object-store URL whose
host (`minio.…svc.cluster.local`) only resolves **inside** the cluster — useless
from a laptop. `--raw` writes the file's own bytes to stdout instead, so
`read-file <id> <path> --raw > file` reproduces the file byte for byte. Binary
files are refused with a pointer to `install`, never dumped as mojibake.

`--raw` and `--draft` compose. Draft reads are served inline by the backend in
one request; published reads fall back to fetching the archive once per run and
serving every later read from it.

## Running a skill

```bash
openbkn skill execute <id> --entry 'python scripts/generate_page.py --list-styles'
openbkn skill execute <id> --entry 'python scripts/generate_page.py --style brutalist' --raw > page.html
openbkn skill execute <id> --entry 'python check.py' --exit-code    # exit status = sandbox's
```

The platform uploads the package into a sandbox session and runs `--entry` from
its work dir, so scripts reach bundled files by relative path
(`styles/brutalist/tokens.json`). `--raw` writes the run's stdout straight
through (stderr stays on stderr) so output can be redirected into a file;
`--exit-code` is opt-in, since it changes what the process returns. A sandbox
that reports `mocked=true` exits `125`: nothing failed, but nothing ran either,
and `--exit-code && next-step` must not read that as a pass. An exit code the
shell cannot represent (>255) becomes `1` rather than truncating to `0`.

Check `mocked` in the response: `true` means the sandbox stubbed the run and the
skill never executed. `--raw` prints that warning to stderr so it can't
contaminate a redirected capture.
