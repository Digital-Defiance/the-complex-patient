#!/usr/bin/env bash
# Sync wp/complex-patient → production WordPress (SSH host: complex).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="${ROOT}/wp/complex-patient/"
DEST="complex:/home/thecompl/domains/thecomplexpatient.com/public_html/wp-content/plugins/complex-patient/"

if [[ ! -d "$SRC" ]]; then
  echo "Plugin source not found: ${SRC}" >&2
  exit 1
fi

rsync -avzc --delete \
  --exclude '.phpunit.cache/' \
  --exclude 'tests/' \
  --exclude 'phpunit.xml' \
  "${SRC}" "${DEST}"
