#!/bin/bash
# Install + activate the pinned emcc (emscripten/EMCC_VERSION) into ./emsdk.
#
#   bash scripts/emsdk-pinned.sh            # → <repo>/emsdk (git-ignored)
#   WATERSHED_EMSDK_DIR=/opt/emsdk-pin bash scripts/emsdk-pinned.sh
#
# emscripten/build.sh looks in <repo>/emsdk first and builds with the first
# emsdk whose emcc matches the pin, so after this script a plain
# `pnpm build:wasm` uses the same compiler as CI no matter what other emsdk
# is on the box. Nothing here touches a system-wide emsdk.
#
# EMSDK_GIT_URL overrides the clone source (e.g. a local emsdk checkout to
# skip the network for the clone; the toolchain itself is still downloaded).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PIN="$(tr -d '[:space:]' < "$REPO_ROOT/emscripten/EMCC_VERSION")"
EMSDK_DIR="${WATERSHED_EMSDK_DIR:-$REPO_ROOT/emsdk}"
EMSDK_GIT_URL="${EMSDK_GIT_URL:-https://github.com/emscripten-core/emsdk.git}"

if [ ! -x "$EMSDK_DIR/emsdk" ]; then
    echo "[emsdk-pinned] cloning emsdk → $EMSDK_DIR"
    git clone --depth 1 "$EMSDK_GIT_URL" "$EMSDK_DIR"
fi

cd "$EMSDK_DIR"
./emsdk install "$PIN"
./emsdk activate "$PIN" >/dev/null

# shellcheck source=/dev/null
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
GOT="$(emcc --version | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
if [ "$GOT" != "$PIN" ]; then
    echo "[emsdk-pinned] activated emcc is $GOT, expected $PIN" >&2
    exit 1
fi
echo "[emsdk-pinned] emcc $PIN ready in $EMSDK_DIR"
