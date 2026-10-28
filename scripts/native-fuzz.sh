#!/bin/bash
# Run every libFuzzer target (#467, #502): swe, chores, forces (+ particles),
# routing — FUZZ_SECONDS each (default 60), under ASan + UBSan.
#
#   pnpm test:native:fuzz
#   FUZZ_SECONDS=600 FUZZ_TARGETS="chores routing" pnpm test:native:fuzz
#
# Each target keeps its own corpus under emscripten/build-fuzz/corpus/<name>,
# so a CI cache of that directory carries coverage between runs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/emscripten/build-fuzz"
TARGETS="${FUZZ_TARGETS:-swe chores forces routing}"
SECONDS_EACH="${FUZZ_SECONDS:-60}"

cmake -S "$ROOT/emscripten" -B "$BUILD" -DWATERSHED_FUZZ=ON -DCMAKE_CXX_COMPILER="${CXX_FUZZ:-clang++}" >/dev/null
for t in $TARGETS; do
    cmake --build "$BUILD" --target "watershed_${t}_fuzz"
done
for t in $TARGETS; do
    mkdir -p "$BUILD/corpus/$t"
    echo "[fuzz] watershed_${t}_fuzz for ${SECONDS_EACH}s"
    "$BUILD/watershed_${t}_fuzz" -max_total_time="$SECONDS_EACH" -print_funcs=0 -print_final_stats=1 \
        "$BUILD/corpus/$t"
done
echo "[fuzz] ${TARGETS// /, }: no crash"
