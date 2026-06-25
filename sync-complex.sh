#!/usr/bin/env bash
# Sync wp/complex-patient → production WordPress (SSH host: complex), then repair DB schema.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="${ROOT}/wp/complex-patient/"
DEST="complex:/home/thecompl/domains/thecomplexpatient.com/public_html/wp-content/plugins/complex-patient/"
SSH_HOST="${COMPLEX_PATIENT_SSH_HOST:-complex}"
PRODUCTION_WP_ROOT="${COMPLEX_PATIENT_PRODUCTION_WP_ROOT:-/home/thecompl/domains/thecomplexpatient.com/public_html}"
PRODUCTION_WP_HOST="${COMPLEX_PATIENT_PRODUCTION_WP_HOST:-thecomplexpatient.com}"

# shellcheck source=sync-complex-repair.sh
source "${ROOT}/sync-complex-repair.sh"

if [[ ! -d "$SRC" ]]; then
  echo "Plugin source not found: ${SRC}" >&2
  exit 1
fi

rsync -avzc --delete \
  --exclude '.phpunit.cache/' \
  --exclude 'tests/' \
  --exclude 'phpunit.xml' \
  "${SRC}" "${DEST}"

echo "Plugin synced to production (${SSH_HOST})"

repair_plugin_schema_via_ssh "${SSH_HOST}" "${PRODUCTION_WP_ROOT}" "${PRODUCTION_WP_HOST}" || true
