# skill — registry / market / lifecycle

| Command | Notes |
|---------|-------|
| `list` / `market` / `get <id>` / `market <id>` | Browse registry + market. |
| `content <id>` / `read-file <id> <rel-path>` / `history <id>` | Progressive read + versions. |
| `set-status <id> <status>` | unpublish | published | offline. |
| `register <dir> [--source] [--extend-info <json>]` | Zip a local skill dir → multipart register. SKILL.md must have frontmatter (name/description). |
| `download <id> [out.zip]` / `install <id> [dir]` | Save archive / download + unzip. |
| `update-metadata <id> --body <json>` / `update-package <id> <dir>` | Edit metadata / replace package (zip). |
| `republish <id> --version <v>` / `publish-history <id> --version <v>` | Republish / publish a historical version. |
