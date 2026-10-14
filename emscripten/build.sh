#!/bin/bash
# Build script for Watershed Emscripten WASM module
#
# Usage:
#   ./build.sh              # single-threaded release build → ../public/ (the shipped pair)
#   ./build.sh --threads    # multi-threaded build → build-threads/out/ (never shipped)
#   ./build.sh --debug      # debug build (assertions, SAFE_HEAP, -O0) → build-debug/out/
#
# Output of the default build (written to ../public/ so Vite serves them):
#   watershed_native.js          — Emscripten glue
#   watershed_native.wasm        — WASM binary
# plus src/systems/water/wasmArtifactStamp.ts.
#
# Only the default build ever writes public/ or the stamp. --threads and
# --debug always build aside: the committed single-thread pair is the only
# shipped build, and production sends no COOP/COEP (#454, #461).
#
# Toolchain pin (#467): the shipped pair must come from the emcc named in
# emscripten/EMCC_VERSION. This script builds with the first emsdk whose emcc
# matches the pin (<repo>/emsdk first — see scripts/emsdk-pinned.sh). A
# mismatch is fatal. WATERSHED_ALLOW_EMCC_MISMATCH=1 builds anyway, but into
# build/out/ — never public/, never the stamp.
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
        *) echo "[build:wasm] unknown argument: $arg" >&2; exit 2 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_DIR="$REPO_ROOT/public"
PINNED_EMCC_VERSION="$(tr -d '[:space:]' < "$SCRIPT_DIR/EMCC_VERSION")"

emcc_version() {
    emcc --version 2>/dev/null | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true
}

# Version an emsdk_env.sh would activate, without touching this shell.
emsdk_version() {
    bash -c 'source "$1" >/dev/null 2>&1; emcc --version 2>/dev/null' _ "$1" \
        | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true
}

CANDIDATES=(
    "$REPO_ROOT/emsdk/emsdk_env.sh"
    /content/build*/emsdk/emsdk_env.sh
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
    "/opt/emsdk/emsdk_env.sh"
    "/root/emsdk/emsdk_env.sh"
)

# An emcc already on PATH at the pin wins (CI's setup-emsdk). Otherwise use
# the first emsdk at the pin. With none at the pin, keep a PATH emcc if there
# is one, else the first emsdk found, so the mismatch below names a real
# version instead of "not found".
if [ "$(emcc_version)" != "$PINNED_EMCC_VERSION" ]; then
    FIRST_FOUND=""
    PINNED_FOUND=""
    for f in "${CANDIDATES[@]}"; do
        [ -f "$f" ] || continue
        [ -n "$FIRST_FOUND" ] || FIRST_FOUND="$f"
        if [ "$(emsdk_version "$f")" = "$PINNED_EMCC_VERSION" ]; then
            PINNED_FOUND="$f"
            break
        fi
    done
    if [ -n "$PINNED_FOUND" ]; then
        # shellcheck source=/dev/null
        source "$PINNED_FOUND" >/dev/null 2>&1
    elif ! command -v emcc &>/dev/null && [ -n "$FIRST_FOUND" ]; then
        # shellcheck source=/dev/null
        source "$FIRST_FOUND" >/dev/null 2>&1
    fi
fi

if ! command -v emcmake &>/dev/null; then
    echo "[build:wasm] Emscripten not found. Install the pinned toolchain with:" >&2
    echo "[build:wasm]   bash scripts/emsdk-pinned.sh" >&2
    exit 1
fi

EMCC_VER="$(emcc_version)"
EMCC_MISMATCH=0
if [ "$EMCC_VER" != "$PINNED_EMCC_VERSION" ]; then
    EMCC_MISMATCH=1
    echo "[build:wasm] emcc ${EMCC_VER:-unknown} != pinned ${PINNED_EMCC_VERSION}." >&2
    if [ "${WATERSHED_ALLOW_EMCC_MISMATCH:-}" != "1" ]; then
        echo "[build:wasm] The shipped public/watershed_native.{js,wasm} must come from ${PINNED_EMCC_VERSION}." >&2
        echo "[build:wasm] Run 'bash scripts/emsdk-pinned.sh', or set WATERSHED_ALLOW_EMCC_MISMATCH=1" >&2
        echo "[build:wasm] to build aside into emscripten/build/out/ (public/ is left alone)." >&2
        exit 1
    fi
fi

BUILD_DIR="$SCRIPT_DIR/build"
if [ "$USE_THREADS" -eq 1 ]; then
    BUILD_DIR="$SCRIPT_DIR/build-threads"
elif [ "$DEBUG_BUILD" -eq 1 ]; then
    BUILD_DIR="$SCRIPT_DIR/build-debug"
fi
OUTPUT_DIR="$PUBLIC_DIR"
SHIPPED=1
if [ "$USE_THREADS" -eq 1 ] || [ "$DEBUG_BUILD" -eq 1 ] || [ "$EMCC_MISMATCH" -eq 1 ]; then
    OUTPUT_DIR="$BUILD_DIR/out"
    SHIPPED=0
fi

if [ "$USE_THREADS" -eq 1 ]; then
    echo "Building watershed_native.js (multi-threaded via CMake, emcc $EMCC_VER)..."
elif [ "$DEBUG_BUILD" -eq 1 ]; then
    echo "Building watershed_native.js (debug via CMake, emcc $EMCC_VER)..."
else
    echo "Building watershed_native.js (single-threaded, optimised via CMake, emcc $EMCC_VER)..."
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
mkdir -p "$BUILD_DIR" "$OUTPUT_DIR"

pushd "$BUILD_DIR" >/dev/null
emcmake cmake .. \
  -DCMAKE_BUILD_TYPE="$CMAKE_BUILD_TYPE" \
  -DWATERSHED_THREADS="$THREADS_FLAG" \
  -DWATERSHED_OUTPUT_DIR="$OUTPUT_DIR"
cmake --build . --config "$CMAKE_BUILD_TYPE"
popd >/dev/null

OUTPUT_JS="$OUTPUT_DIR/watershed_native.js"
OUTPUT_WASM="$OUTPUT_DIR/watershed_native.wasm"
if [ ! -f "$OUTPUT_JS" ] || [ ! -f "$OUTPUT_WASM" ]; then
    echo "Build failed — no output produced." >&2
    exit 1
fi

echo ""
echo "Build successful!"
echo "  → $OUTPUT_JS"
echo "  WASM size: $(wc -c < "$OUTPUT_WASM") bytes"

# Glue + wasm only. Same inputs as the loader's stamp hash (WatershedWasm.ts).
STAMP=$(cat "$OUTPUT_JS" "$OUTPUT_WASM" | sha256sum | cut -c1-16)
if [ "$SHIPPED" -eq 1 ]; then
    STAMP_FILE="$REPO_ROOT/src/systems/water/wasmArtifactStamp.ts"
    cat > "$STAMP_FILE" <<EOF
/** Generated by emscripten/build.sh — do not edit by hand. */
export const WASM_ARTIFACT_STAMP = '${STAMP}';
EOF
    echo "  Artifact stamp: ${STAMP}"
else
    echo "  Built aside in $OUTPUT_DIR (stamp ${STAMP}, not written)."
    echo "  public/ and wasmArtifactStamp.ts are untouched."
fi

if [ "$USE_THREADS" -eq 1 ]; then
    WORKER_JS="$OUTPUT_DIR/watershed_native.worker.mjs"
    if [ -f "$WORKER_JS" ]; then
        echo "  → $WORKER_JS (pthread worker shim)"
    fi
fi
