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

set -euo pipefail
source /content/buil*/emsdk/emsdk_env.sh

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
USE_THREADS=0
DEBUG_BUILD=0

for arg in "$@"; do
    case "$arg" in
        --threads) USE_THREADS=1 ;;
        --debug)   DEBUG_BUILD=1  ;;
    esac
done

if [ "$USE_THREADS" -eq 1 ]; then
    echo "Building watershed_native.js (multi-threaded)..."
elif [ "$DEBUG_BUILD" -eq 1 ]; then
    echo "Building watershed_native.js (debug, single-threaded)..."
else
    echo "Building watershed_native.js (single-threaded, optimised)..."
fi

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_JS="$REPO_ROOT/public/watershed_native.js"

# ---------------------------------------------------------------------------
# Locate and source the Emscripten environment
# ---------------------------------------------------------------------------
CANDIDATES=(
    "$REPO_ROOT/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
    "/opt/emsdk/emsdk_env.sh"
)

FOUND=0
for f in "${CANDIDATES[@]}"; do
    if [ -f "$f" ]; then
        # shellcheck source=/dev/null
        source "$f"
        FOUND=1
        break
    fi
done

if [ "$FOUND" -eq 0 ]; then
    if command -v em++ &>/dev/null; then
        echo "Using em++ already in PATH."
    else
        echo "ERROR: Emscripten SDK not found."
        echo "Install from: https://emscripten.org/docs/getting_started/downloads.html"
        echo "Searched: ${CANDIDATES[*]}"
        exit 1
    fi
fi

# ---------------------------------------------------------------------------
# Memory allocation (64 MB initial heap — grows as needed via ALLOW_MEMORY_GROWTH)
# ---------------------------------------------------------------------------
INITIAL_MEMORY_BYTES=67108864  # 64 * 1024 * 1024
if [ "$DEBUG_BUILD" -eq 1 ]; then
    COMPILE_FLAGS="-O0 -g3 -msimd128 -mbulk-memory"
else
    COMPILE_FLAGS="-O3 -msimd128 -ffast-math -fno-exceptions -fno-rtti -funroll-loops -mbulk-memory"
fi

if [ "$USE_THREADS" -eq 1 ]; then
    COMPILE_FLAGS="$COMPILE_FLAGS -pthread"
fi

# ---------------------------------------------------------------------------
# Linker flags
# ---------------------------------------------------------------------------
if [ "$DEBUG_BUILD" -eq 1 ]; then
    OPT_FLAGS="-O0 -s ASSERTIONS=2 -s SAFE_HEAP=1"
else
    OPT_FLAGS="-O3 -s ASSERTIONS=0"
fi

LINK_FLAGS="$OPT_FLAGS \
  -s WASM=1 \
  -s WASM_BIGINT=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=${INITIAL_MEMORY_BYTES} \
  -s EXPORT_ES6=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='createWatershedNative' \
  --bind"

if [ "$USE_THREADS" -eq 1 ]; then
    LINK_FLAGS="$LINK_FLAGS \
  -s USE_PTHREADS=1 \
  -s PTHREAD_POOL_SIZE=4 \
  -s ENVIRONMENT='web,worker'"
else
    LINK_FLAGS="$LINK_FLAGS \
  -s ENVIRONMENT='web'"
fi

# ---------------------------------------------------------------------------
# Clean stale artefacts (forces a full rebuild)
# ---------------------------------------------------------------------------
rm -f "$OUTPUT_JS" \
      "$REPO_ROOT/public/watershed_native.wasm" \
      "$REPO_ROOT/public/watershed_native.worker.js"

# ---------------------------------------------------------------------------
# Compile & link
# ---------------------------------------------------------------------------
echo "Compiling & Linking..."
# shellcheck disable=SC2086  # word-splitting on FLAGS is intentional
em++ "$SCRIPT_DIR/main.cpp" \
    -o "$OUTPUT_JS" \
    $COMPILE_FLAGS \
    $LINK_FLAGS

if [ -f "$OUTPUT_JS" ]; then
    echo ""
    echo "Build successful!"
    echo "  → $OUTPUT_JS"
    if [ -f "$REPO_ROOT/public/watershed_native.wasm" ]; then
        WASM_SIZE=$(wc -c < "$REPO_ROOT/public/watershed_native.wasm")
        echo "  WASM size: ${WASM_SIZE} bytes"
    fi
    if [ "$USE_THREADS" -eq 1 ]; then
        if [ -f "$REPO_ROOT/public/watershed_native.worker.js" ]; then
            echo "  → $REPO_ROOT/public/watershed_native.worker.js (pthread worker shim)"
        else
            echo "  WARNING: watershed_native.worker.js not found — pthread worker shim may be missing."
        fi
    fi
else
    echo "Build failed — no output produced."
    exit 1
fi
