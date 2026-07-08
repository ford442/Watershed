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
# Locate and source the Emscripten environment (portable across hosts)
# ---------------------------------------------------------------------------
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

if ! command -v emcc &>/dev/null; then
  echo "[build:wasm] Emscripten not found — skipping WASM compile (run 'source emsdk_env.sh' first)."
  exit 0
fi

# ---------------------------------------------------------------------------
# Memory allocation (64 MB initial heap — grows as needed via ALLOW_MEMORY_GROWTH)
# ---------------------------------------------------------------------------
INITIAL_MEMORY_BYTES=67108864  # 64 * 1024 * 1024
if [ "$DEBUG_BUILD" -eq 1 ]; then
    COMPILE_FLAGS="-O0 -g3 -msimd128 -mbulk-memory"
else
    COMPILE_FLAGS="-O3 -msimd128 -ffast-math -fno-exceptions -fno-rtti -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 -funroll-loops -mbulk-memory"
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
  -s EXPORTED_RUNTIME_METHODS=HEAPF32,HEAP32,HEAPU8 \
  -s EXPORT_ES6=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='createWatershedNative' \
  --bind"

if [ "$USE_THREADS" -eq 1 ]; then
    LINK_FLAGS="$LINK_FLAGS \
  -s USE_PTHREADS=1 \
  -s PTHREAD_POOL_SIZE=4 \
  -s ENVIRONMENT=web,worker"
else
    LINK_FLAGS="$LINK_FLAGS \
  -s ENVIRONMENT=web"
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
        WORKER_JS="$REPO_ROOT/public/watershed_native.worker.js"
        if [ -f "$WORKER_JS" ]; then
            echo "  → $WORKER_JS (pthread worker shim)"
        elif grep -q "PThread\|postMessage\|new Blob" "$OUTPUT_JS" 2>/dev/null; then
            echo "  pthread worker shim embedded in watershed_native.js (modern Emscripten)"
        else
            echo "  WARNING: pthread worker shim not found in output — check Emscripten version"
        fi
    fi
else
    echo "Build failed — no output produced."
    exit 1
fi
