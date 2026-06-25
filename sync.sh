#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
"${ROOT}/sync-complex.sh"
"${ROOT}/sync-complex-local.sh"
