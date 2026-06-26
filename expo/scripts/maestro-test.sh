#!/usr/bin/env bash
# Run Maestro UI flows against a booted iOS Simulator or Android Emulator.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v maestro >/dev/null 2>&1; then
  echo "Maestro CLI not found." >&2
  echo "Install: curl -Ls \"https://get.maestro.mobile.dev\" | bash" >&2
  exit 1
fi

ENV_FILE="$ROOT/.maestro/.env"
MAESTRO_ARGS=()

if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -z "$line" ]] && continue
    if [[ "$line" == *=* ]]; then
      key="${line%%=*}"
      value="${line#*=}"
      [[ -n "$key" && -n "$value" ]] || continue
      MAESTRO_ARGS+=(-e "$line")
    fi
  done < "$ENV_FILE"

  if ! grep -q '^MAESTRO_WP_PASSWORD=.\+' "$ENV_FILE" 2>/dev/null; then
    echo "Warning: MAESTRO_WP_PASSWORD is missing in ${ENV_FILE}. Run: yarn maestro:provision" >&2
  fi
else
  echo "Warning: ${ENV_FILE} not found. Run: yarn maestro:provision" >&2
fi

TARGET="${1:-$ROOT/.maestro/flows}"

if [[ $# -gt 0 ]]; then
  shift
fi

echo "Maestro → $TARGET"
if ((${#MAESTRO_ARGS[@]} > 0)); then
  exec maestro test "${MAESTRO_ARGS[@]}" "$TARGET" "$@"
fi
exec maestro test "$TARGET" "$@"
