#!/usr/bin/env bash
# Shared schema repair helpers for sync-complex*.sh

repair_plugin_schema() {
  local base_url="${1%/}"
  local response

  if ! response="$(curl -fsS -X POST "${base_url}/wp-json/complex-patient/v1/system/schema/repair" \
    -H 'Content-Type: application/json')"; then
    echo "Warning: could not repair database schema at ${base_url}." >&2
    echo "  • Is WordPress running?" >&2
    echo "  • Open ${base_url} once in a browser, then run sync again." >&2
    return 1
  fi

  echo "Schema repair: ${response}"
  verify_plugin_schema_response "$response"
}

resolve_remote_php_bin() {
  local ssh_host="$1"
  local explicit="${COMPLEX_PATIENT_REMOTE_PHP_BIN:-}"
  local candidates=()
  local bin
  local discovered

  if [[ -n "$explicit" ]]; then
    candidates+=("$explicit")
  fi

  discovered="$(ssh "${ssh_host}" "sh -c 'for p in /usr/local/php8*/bin/php /opt/alt/php8*/usr/bin/php; do [ -x \"\$p\" ] && echo \"\$p\"; done' 2>/dev/null | sort -V")"
  while IFS= read -r bin; do
    [[ -n "$bin" ]] && candidates+=("$bin")
  done <<<"${discovered}"

  candidates+=(
    ea-php83 ea-php82 ea-php81
    php83 php82 php81
    /usr/local/bin/ea-php83
    /usr/local/bin/ea-php82
    /usr/local/bin/ea-php81
    /opt/cpanel/ea-php83/root/usr/bin/php
    /opt/cpanel/ea-php82/root/usr/bin/php
    /opt/cpanel/ea-php81/root/usr/bin/php
    /usr/bin/php83
    /usr/bin/php82
    /usr/bin/php81
    php
  )

  for bin in "${candidates[@]}"; do
    if ssh "${ssh_host}" "command -v '${bin}' >/dev/null 2>&1 && '${bin}' -r 'exit(version_compare(PHP_VERSION, \"8.1.0\", \">=\") ? 0 : 1);'"; then
      printf '%s' "${bin}"
      return 0
    fi
  done

  local cli_version
  cli_version="$(ssh "${ssh_host}" "php -r 'echo PHP_VERSION;' 2>/dev/null" || echo unknown)"
  echo "Warning: no PHP >= 8.1 CLI found on ${ssh_host} (default php is ${cli_version})." >&2
  echo "  Set COMPLEX_PATIENT_REMOTE_PHP_BIN (DirectAdmin: /usr/local/php82/bin/php)." >&2
  return 1
}

repair_plugin_schema_via_wp_load_ssh() {
  local ssh_host="$1"
  local wp_root="$2"
  local php_bin="$3"
  local response

  if ! response="$(ssh "${ssh_host}" "cd '${wp_root}' && '${php_bin}'" <<'PHP'
<?php
require 'wp-load.php';
global $wpdb;

if (! class_exists('ComplexPatient\\Activation')) {
    file_put_contents('php://stderr', "Complex Patient plugin is not loaded.\n");
    exit(2);
}

$repaired = \ComplexPatient\Activation::repairMissingTables($wpdb);
$tables = \ComplexPatient\Activation::getSchemaStatus($wpdb);

echo json_encode([
    'ok' => ! in_array(false, $tables, true),
    'repaired' => $repaired,
    'tables' => $tables,
]);
PHP
  )"; then
    return 1
  fi

  echo "Schema repair: ${response}"
  verify_plugin_schema_response "$response"
}

repair_plugin_schema_via_https() {
  local wp_host="$1"
  local repair_key="${COMPLEX_PATIENT_SCHEMA_REPAIR_KEY:-}"
  local response

  if [[ -z "$repair_key" ]]; then
    return 1
  fi

  if ! response="$(curl -fsS -X POST "https://${wp_host}/wp-json/complex-patient/v1/system/schema/repair" \
    -H 'Content-Type: application/json' \
    -H "X-Complex-Patient-Schema-Repair-Key: ${repair_key}")"; then
    return 1
  fi

  echo "Schema repair: ${response}"
  verify_plugin_schema_response "$response"
}

repair_plugin_schema_via_ssh() {
  local ssh_host="$1"
  local wp_root="$2"
  local wp_host="$3"
  local php_bin

  if php_bin="$(resolve_remote_php_bin "${ssh_host}")"; then
    echo "Repairing production schema via wp-load.php on ${ssh_host} (${php_bin})..."
    if repair_plugin_schema_via_wp_load_ssh "${ssh_host}" "${wp_root}" "${php_bin}"; then
      return 0
    fi
    echo "wp-load.php repair failed; trying other methods..." >&2
  fi

  if repair_plugin_schema_via_https "${wp_host}"; then
    return 0
  fi

  echo "Warning: could not repair production schema on ${ssh_host}." >&2
  echo "  • Set COMPLEX_PATIENT_REMOTE_PHP_BIN if CLI PHP differs from the web handler." >&2
  echo "  • Or set COMPLEX_PATIENT_SCHEMA_REPAIR_KEY in wp-config.php and your shell." >&2
  echo "  • The plugin still runs ensureSchema() on the next web request (PHP 8.1+)." >&2
  return 1
}

verify_plugin_schema_response() {
  local response="$1"

  if ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi

  python3 - <<'PY' "$response"
import json, sys
data = json.loads(sys.argv[1])
tables = data.get("tables", {})
missing = [name for name, present in tables.items() if not present]
if missing:
    print(f"Warning: still missing tables: {', '.join(missing)}", file=sys.stderr)
    sys.exit(1)
print("All plugin tables present (including paper_backup).")
PY
}
