#!/usr/bin/env bash
# Capture --help baselines from the installed legacy Kweaver CLIs, at FULL DEPTH.
# These are the golden fixtures the equivalence tests assert against — every
# command, subcommand, and sub-subcommand must stay equivalent (esp. help).
# Re-run after upgrading the legacy CLIs; commit the diff.
#
# Requires: `kweaver` (@kweaver-ai/kweaver-sdk) and `kweaver-admin`
# (@kweaver-ai/kweaver-admin) on PATH. Needs bash (macOS bash 3.2 is fine).
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/baselines"
mkdir -p "$out/kweaver" "$out/kweaver-admin/sub"

# ---- kweaver (custom grouped help) -----------------------------------------
# `help all` is the authoritative FULL-DEPTH signature manifest for kweaver:
# it lists every command/subcommand/sub-subcommand signature. Depth-1 group
# help is captured too (the grouped layout we must reproduce).
kweaver --help   > "$out/kweaver/_root.help.txt" 2>&1 || true
kweaver help all > "$out/kweaver/_help-all.txt"  2>&1 || true

kw_cmds="auth token config agent toolbox tool bkn resource dataflow vega \
         context-loader trace call explore model skill"
for c in $kw_cmds; do
  kweaver "$c" --help > "$out/kweaver/$c.help.txt" 2>&1 || true
done

# ---- kweaver-admin (commander) ---------------------------------------------
# Depth-1 group help + depth-2 per-subcommand help (commander has no `help all`).
kweaver-admin --help > "$out/kweaver-admin/_root.help.txt" 2>&1 || true

kwa_cmds="auth org user role llm small-model audit config call"
for c in $kwa_cmds; do
  kweaver-admin "$c" --help > "$out/kweaver-admin/$c.help.txt" 2>&1 || true
done

# Depth-2: "<cmd> <sub>" pairs. Keep in sync with the legacy command tree.
admin_subs='auth login logout status whoami list change-password token
org list tree get create update delete members
user list get create update delete roles assign-role revoke-role reset-password
role list get members add-member remove-member
llm list get add edit delete test
small-model list get add edit delete test
audit list
config show set'
while IFS= read -r line; do
  set -- $line
  cmd=$1; shift
  for sub in "$@"; do
    kweaver-admin "$cmd" "$sub" --help > "$out/kweaver-admin/sub/${cmd}__${sub}.help.txt" 2>&1 || true
  done
done <<EOF
$admin_subs
EOF

echo "Captured baselines under $out"
echo "  kweaver:           $(ls "$out/kweaver" | wc -l | tr -d ' ') files (+ _help-all = full depth manifest)"
echo "  kweaver-admin:     $(ls "$out/kweaver-admin"/*.txt | wc -l | tr -d ' ') depth-1 files"
echo "  kweaver-admin/sub: $(ls "$out/kweaver-admin/sub" | wc -l | tr -d ' ') depth-2 files"
