#!/usr/bin/env bash
# Sync wp/complex-patient → local WordPress Studio site, then repair DB schema.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="${ROOT}/wp/complex-patient/"
DEST="/Users/jessica/Studio/the-complex-patient/wp-content/plugins/complex-patient/"
LOCAL_WP_URL="${COMPLEX_PATIENT_LOCAL_WP_URL:-http://localhost:8881}"

# shellcheck source=sync-complex-repair.sh
source "${ROOT}/sync-complex-repair.sh"

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

echo "Plugin synced to ${DEST}"

repair_plugin_schema "${LOCAL_WP_URL}" || true
