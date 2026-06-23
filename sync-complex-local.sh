#!/usr/bin/env bash
# Sync wp/complex-patient → local WordPress Studio site.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="${ROOT}/wp/complex-patient/"
DEST="/Users/jessica/Studio/the-complex-patient/wp-content/plugins/complex-patient/"

if [[ ! -d "$SRC" ]]; then
  echo "Plugin source not found: ${SRC}" >&2
  exit 1
fi

mkdir -p "${DEST}"

rsync -avzc --delete \
  --exclude '.phpunit.cache/' \
  --exclude 'tests/' \
  --exclude 'phpunit.xml' \
  "${SRC}" "${DEST}"
