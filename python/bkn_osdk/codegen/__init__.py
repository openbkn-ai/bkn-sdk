# Copyright (c) 2026 OpenBKN. All rights reserved.
# Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

"""The generator: a pure `schema -> file tree` function plus its CLI shell.

Ships in the same distribution as the runtime but is imported only by the
`bkn-osdk` console script, so it costs an installed consumer nothing at runtime.

The core must stay pure — no HTTP, no filesystem — so that the CLI shell, the
test shell, and a future server-side wheel builder can all drive it.
"""
