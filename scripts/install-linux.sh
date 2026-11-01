#!/usr/bin/env bash
# Builds the Web UI and installs the Omni launcher for this checkout.
#
#   scripts/install-linux.sh
#
# The launcher is ~/.local/share/applications/omni-os.desktop. Open Omni from the
# app launcher after it finishes. It does not start the server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d node_modules/tsx ]]; then
  printf 'install-linux: run npm install --include=dev in %s first\n' "$ROOT" >&2
  exit 1
fi

printf '==> Building the Web UI\n'
npm run build --workspace @omni/web
exec "$ROOT/scripts/omni-linux.sh" --install "$@"
