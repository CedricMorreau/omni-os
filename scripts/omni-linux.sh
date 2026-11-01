#!/usr/bin/env bash
# Opens Omni on Linux. Starts the server from this checkout unless this install already
# answers on the port, then opens the Web UI as an app window. Closing that window stops
# the server only when this launch started it.
#
#   scripts/omni-linux.sh [--check] [--install] [--port N] [--repo PATH]
#
# A desktop launcher has a short PATH, so this finds Node 24+ under mise, nvm and PATH
# before it can run the TypeScript.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

find_node() {
  local candidate version major
  local -a found=()
  shopt -s nullglob
  found+=("${HOME}/.local/share/mise/shims/node")
  found+=("${HOME}/.local/share/mise/installs/node/"*/bin/node)
  found+=("${HOME}/.nvm/versions/node/"*/bin/node)
  local dir
  local IFS=:
  for dir in $PATH; do
    [[ -n "$dir" ]] && found+=("$dir/node")
  done
  unset IFS
  local best="" best_major=0
  for candidate in "${found[@]}"; do
    [[ -x "$candidate" ]] || continue
    version="$("$candidate" -v 2>/dev/null || true)"
    [[ "$version" =~ ^v([0-9]+)\. ]] || continue
    major="${BASH_REMATCH[1]}"
    if (( major >= 24 && major > best_major )); then
      best="$candidate"
      best_major=$major
    fi
  done
  [[ -n "$best" ]] || return 1
  printf '%s\n' "$best"
}

node_bin="$(find_node)" || {
  printf 'omni-linux: Node 24 or later was not found. Install it, then start again.\n' >&2
  exit 1
}

exec "$node_bin" --import tsx "$ROOT/apps/linux/src/main.ts" "$@"
