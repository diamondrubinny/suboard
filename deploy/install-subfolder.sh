#!/usr/bin/env bash
# Kept for existing installations: the installer is now deploy/install.sh (same arguments; it also
# handles a dedicated address). This wrapper downloads and runs it.
set -euo pipefail
REF="${SUBOARD_REF:-${SUBOARD_BRANCH:-main}}"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
curl -fsSL "https://raw.githubusercontent.com/diamondrubinny/suboard/$REF/deploy/install.sh" -o "$TMP"
SUBOARD_REF="$REF" bash "$TMP" "$@"
