#!/bin/bash
# Colab / extra entry: flags and sources live in CMakeLists.txt via build.sh.
# Do not maintain a parallel em++ file list here.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/build.sh" "$@"
