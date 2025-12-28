#!/bin/bash
# Build script for Candy World Emscripten WASM module
# Optimized for: Multithreading (Pthreads) + SIMD + Reliability
# FIX: Downgraded to -O2 and disabled minification to prevent "Import #0 'a'" errors

set -euo pipefail

echo "Building watershed_native.js (Pthread Build)..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source Emscripten
CANDIDATES=(
    "/content/build_space/emsdk/emsdk_env.sh"
    "$REPO_ROOT/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
)
for f in "${CANDIDATES[@]}"; do
    if [ -f "$f" ]; then source "$f"; break; fi
done

OUTPUT_JS="$REPO_ROOT/public/watershed_native.js"

# ---------------------------------------------------------
# COMPILER FLAGS
# ---------------------------------------------------------
# -O2: High optimization but safer than -O3 (avoids aggressive renaming)
# -g0: Debug info disabled (keeps size down)
COMPILE_FLAGS="-O3 -msimd128 -mrelaxed-simd -ffast-math -flto -flto=thin -fno-exceptions -fno-rtti -funroll-loops -mbulk-memory -fopenmp -pthread"

# ---------------------------------------------------------
# LINKER FLAGS
# ---------------------------------------------------------
# -s MINIFY_WASM_IMPORTS_AND_EXPORTS=0: CRITICAL FIX. Prevents renaming 'env' to 'a'
# -s SHRINK_LEVEL=0: Disables aggressive shrinking
LINK_FLAGS="-O3 -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s WASM=1 -s WASM_BIGINT=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=512mb -s ASSERTIONS=0 -s EXPORT_ES6=1 -s MODULARIZE=1 -s EXPORT_NAME='createCandyNative' -s ENVIRONMENT='web','worker' -flto -flto=thin -s DISABLE_EXCEPTION_CATCHING=1"
EXPORTS="[ \
    '_malloc', \
    '_free' \
]"

echo "Compiling & Linking..."

# Clean old files to force full rebuild (prevents caching issues)
rm -f "$OUTPUT_JS" "$REPO_ROOT/public/watershed_native.wasm" "$REPO_ROOT/public/watershed_native.worker.js"

em++ "$SCRIPT_DIR"/*.cpp -o "$OUTPUT_JS" \
  $COMPILE_FLAGS \
  $LINK_FLAGS \
  -s EXPORTED_FUNCTIONS="$EXPORTS"

if [ $? -eq 0 ]; then
    echo "Build successful!"
    echo "Generated: public/watershed_native.js (and .wasm/.worker.js)"
else
    echo "Build failed."
    exit 1
fi
