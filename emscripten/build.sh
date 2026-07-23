#!/bin/bash
# Build script for Watershed Emscripten WASM module
#
# Usage:
#   ./build.sh              # single-threaded build (default; no COOP/COEP needed)
#   ./build.sh --threads    # multi-threaded build  (requires COOP/COEP response headers)
#   ./build.sh --debug      # single-threaded debug build (assertions + no optimisation)
#
# Output (written to ../public/ so Vite serves them as static assets):
#   watershed_native.js          — Emscripten glue + Embind dispatch
#   watershed_native.wasm        — WASM binary
#   watershed_native.worker.js   — Pthread worker shim (--threads only)
#
# Requires: Emscripten SDK (em++ in PATH or auto-located via emsdk_env.sh)
#
# Flag reconciliation: this script is a thin wrapper around emscripten/CMakeLists.txt.
# Do not duplicate compile/link flags here — edit CMakeLists.txt instead.

set -euo pipefail

USE_THREADS=0
DEBUG_BUILD=0

for arg in "$@"; do
    case "$arg" in
        --threads) USE_THREADS=1 ;;
        --debug)   DEBUG_BUILD=1  ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_DIR="$REPO_ROOT/public"
BUILD_DIR="$SCRIPT_DIR/build"

if [ "$USE_THREADS" -eq 1 ]; then
    echo "Building watershed_native.js (multi-threaded via CMake)..."
elif [ "$DEBUG_BUILD" -eq 1 ]; then
    echo "Building watershed_native.js (debug, single-threaded via CMake)..."
else
    echo "Building watershed_native.js (single-threaded, optimised via CMake)..."
fi

CANDIDATES=(
    "$REPO_ROOT/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
    "/opt/emsdk/emsdk_env.sh"
    "/root/emsdk/emsdk_env.sh"
)

for f in /content/build*/emsdk/emsdk_env.sh "${CANDIDATES[@]}"; do
    if [ -f "$f" ]; then
        # shellcheck source=/dev/null
        source "$f"
        break
    fi
done

if ! command -v emcmake &>/dev/null; then
  if [ "${CI:-}" = "true" ] && [ "${WATERSHED_REQUIRE_WASM:-}" = "1" ]; then
    echo "[build:wasm] Emscripten required in CI but emcmake was not found."
    exit 1
  fi
  echo "[build:wasm] Emscripten not found — skipping WASM compile (run 'source emsdk_env.sh' first)."
  exit 0
fi

CMAKE_BUILD_TYPE=Release
if [ "$DEBUG_BUILD" -eq 1 ]; then
    CMAKE_BUILD_TYPE=Debug
fi

THREADS_FLAG=OFF
if [ "$USE_THREADS" -eq 1 ]; then
    THREADS_FLAG=ON
fi

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

pushd "$BUILD_DIR" >/dev/null
emcmake cmake .. \
  -DCMAKE_BUILD_TYPE="$CMAKE_BUILD_TYPE" \
  -DWATERSHED_THREADS="$THREADS_FLAG" \
  -DWATERSHED_OUTPUT_DIR="$PUBLIC_DIR"
cmake --build . --config "$CMAKE_BUILD_TYPE"
popd >/dev/null

OUTPUT_JS="$PUBLIC_DIR/watershed_native.js"
if [ ! -f "$OUTPUT_JS" ]; then
    echo "Build failed — no output produced."
    exit 1
fi

echo ""
echo "Build successful!"
echo "  → $OUTPUT_JS"
if [ -f "$PUBLIC_DIR/watershed_native.wasm" ]; then
    WASM_SIZE=$(wc -c < "$PUBLIC_DIR/watershed_native.wasm")
    echo "  WASM size: ${WASM_SIZE} bytes"
fi

if [ "$USE_THREADS" -eq 1 ]; then
    WORKER_JS="$PUBLIC_DIR/watershed_native.worker.js"
    if [ -f "$WORKER_JS" ]; then
        echo "  → $WORKER_JS (pthread worker shim)"
    fi
fi
