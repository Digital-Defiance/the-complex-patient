#!/usr/bin/env bash
# Run / inspect the latest local EAS production .ipa (build-*.ipa in expo/).
#
# Production IPAs are arm64 device binaries — they do NOT run in the iOS Simulator.
# For simulator parity (release JS bundle, same native code path from source):
#   yarn simulate:ios:release
#
# Usage:
#   ./scripts/run-latest-ipa.sh info              # show newest .ipa metadata
#   ./scripts/run-latest-ipa.sh install          # install on a connected device
#   ./scripts/run-latest-ipa.sh launch            # launch installed app
#   ./scripts/run-latest-ipa.sh run               # install + launch (+ optional logs)
#   ./scripts/run-latest-ipa.sh logs             # stream device logs (release build)
#   ./scripts/run-latest-ipa.sh simulate         # print simulator alternative
#
# Environment:
#   IPA_PATH=path/to/app.ipa   override auto-detected newest build-*.ipa
#   IOS_DEVICE_UDID=...        target a specific connected device
#   STREAM_LOGS=1              with `run`, keep streaming logs after launch

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ID="${IOS_BUNDLE_ID:-org.digitaldefiance.com.complexpatient}"
CACHE_ROOT="$EXPO_ROOT/.ipa-run-cache"

log() { printf '%s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

latest_ipa() {
  if [[ -n "${IPA_PATH:-}" ]]; then
    [[ -f "$IPA_PATH" ]] || die "IPA_PATH not found: $IPA_PATH"
    printf '%s\n' "$IPA_PATH"
    return
  fi

  local newest=""
  local candidate
  shopt -s nullglob
  local matches=("$EXPO_ROOT"/build-*.ipa)
  shopt -u nullglob
  [[ ${#matches[@]} -gt 0 ]] || die "no build-*.ipa found under $EXPO_ROOT — run: yarn build:ios:local"

  newest="${matches[0]}"
  for candidate in "${matches[@]}"; do
    if [[ "$candidate" -nt "$newest" ]]; then
      newest="$candidate"
    fi
  done
  printf '%s\n' "$newest"
}

extract_app_bundle() {
  local ipa="$1"
  local stamp
  stamp="$(basename "$ipa" .ipa)"
  local dest="$CACHE_ROOT/$stamp/Payload"
  local app_glob

  if [[ -d "$dest" ]]; then
    app_glob=("$dest"/*.app)
    [[ -d "${app_glob[0]}" ]] || die "cached extract is incomplete — remove $CACHE_ROOT/$stamp"
    printf '%s\n' "${app_glob[0]}"
    return
  fi

  mkdir -p "$CACHE_ROOT/$stamp"
  log "extracting $(basename "$ipa") → $CACHE_ROOT/$stamp"
  unzip -q -o "$ipa" -d "$CACHE_ROOT/$stamp"
  app_glob=("$dest"/*.app)
  [[ -d "${app_glob[0]}" ]] || die "no .app bundle found inside $(basename "$ipa")"
  printf '%s\n' "${app_glob[0]}"
}

ipa_info() {
  local ipa="$1"
  local app="$2"
  local plist="$app/Info.plist"
  local binary="$app/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"

  log "ipa:        $ipa"
  log "bundle id:  $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
  log "version:    $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist") ($(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist"))"
  log "app:        $(basename "$app")"
  if command -v lipo >/dev/null 2>&1; then
    log "arch:       $(lipo -info "$binary" 2>/dev/null || file "$binary")"
  else
    log "arch:       $(file "$binary")"
  fi
  log
  log "note: device-only builds cannot run in the iOS Simulator."
  log "      for simulator release testing: yarn simulate:ios:release"
}

pick_device_udid() {
  if [[ -n "${IOS_DEVICE_UDID:-}" ]]; then
    printf '%s\n' "$IOS_DEVICE_UDID"
    return
  fi

  local json_file
  json_file="$(mktemp)"
  xcrun devicectl list devices --json-output "$json_file" >/dev/null 2>&1 || true

  python3 - "$json_file" <<'PY'
import json, sys
path = sys.argv[1]
try:
    data = json.load(open(path))
except FileNotFoundError:
    sys.exit(0)
devices = data.get("result", {}).get("devices", [])
candidates = []
for d in devices:
    props = d.get("connectionProperties", {})
    tunnel = props.get("tunnelState", "")
    pairing = props.get("pairingState", "")
    name = d.get("deviceProperties", {}).get("name") or d.get("name", "device")
    identifier = d.get("identifier")
    hardware = d.get("hardwareProperties", {})
    udid = hardware.get("udid") or identifier
    if not udid:
        continue
    if tunnel not in ("unavailable", ""):
        candidates.append((0, name, udid))
    elif pairing == "paired":
        candidates.append((1, name, udid))
if not candidates:
    sys.exit(0)
candidates.sort()
print(candidates[0][2])
PY
  rm -f "$json_file"
}

require_device() {
  local udid
  udid="$(pick_device_udid || true)"
  if [[ -z "$udid" ]]; then
    die "no connected iOS device found.
  • plug in iPhone/iPad and trust this Mac
  • enable Developer Mode on the device (Settings → Privacy & Security)
  • or set IOS_DEVICE_UDID=<udid> (xcrun devicectl list devices)"
  fi
  printf '%s\n' "$udid"
}

install_app() {
  local udid="$1"
  local app="$2"
  log "installing on device $udid …"
  xcrun devicectl device install app --device "$udid" "$app"
}

launch_app() {
  local udid="$1"
  log "launching $BUNDLE_ID …"
  xcrun devicectl device process launch --device "$udid" "$BUNDLE_ID"
}

stream_logs() {
  local udid="${1:-}"
  log "streaming logs (Ctrl+C to stop) — filter: ComplexPatient / ReactNative / PaperBackup"
  if [[ -n "$udid" ]]; then
    log stream --style compact --device "$udid" \
      --predicate 'process CONTAINS[c] "ComplexPatient" OR eventMessage CONTAINS[c] "ReactNative" OR eventMessage CONTAINS[c] "PaperBackup"' \
      2>/dev/null || log stream --style compact \
      --predicate 'process CONTAINS[c] "ComplexPatient" OR eventMessage CONTAINS[c] "ReactNative" OR eventMessage CONTAINS[c] "PaperBackup"'
  else
    log stream --style compact \
      --predicate 'process CONTAINS[c] "ComplexPatient" OR eventMessage CONTAINS[c] "ReactNative" OR eventMessage CONTAINS[c] "PaperBackup"'
  fi
}

cmd_simulate() {
  cat <<'EOF'
Production .ipa files are signed for physical devices (arm64) and cannot be
installed on the iOS Simulator.

Closest local alternatives:

  1. Release build on Simulator (same codebase, release optimizations):
       yarn simulate:ios:release

  2. Dev client with Metro (fast iteration):
       yarn ios

  3. Physical device with the actual .ipa artifact:
       yarn run:ios:ipa
EOF
}

main() {
  local cmd="${1:-run}"
  local ipa app udid

  case "$cmd" in
    info)
      ipa="$(latest_ipa)"
      app="$(extract_app_bundle "$ipa")"
      ipa_info "$ipa" "$app"
      ;;
    install)
      ipa="$(latest_ipa)"
      app="$(extract_app_bundle "$ipa")"
      udid="$(require_device)"
      install_app "$udid" "$app"
      ;;
    launch)
      udid="$(require_device)"
      launch_app "$udid"
      ;;
    run)
      ipa="$(latest_ipa)"
      app="$(extract_app_bundle "$ipa")"
      udid="$(require_device)"
      ipa_info "$ipa" "$app"
      install_app "$udid" "$app"
      launch_app "$udid"
      if [[ "${STREAM_LOGS:-1}" == "1" ]]; then
        stream_logs "$udid"
      fi
      ;;
    logs)
      udid="$(pick_device_udid || true)"
      stream_logs "$udid"
      ;;
    simulate)
      cmd_simulate
      ;;
    -h|--help|help)
      sed -n '1,20p' "$0"
      ;;
    *)
      die "unknown command: $cmd (try: info | install | launch | run | logs | simulate)"
      ;;
  esac
}

main "$@"
