#!/bin/bash
# Run every libFuzzer target (#467, #502): swe, chores, forces (+ particles),
# routing — FUZZ_SECONDS each (default 60), under ASan + UBSan.
#
#   pnpm test:native:fuzz
#   FUZZ_SECONDS=600 FUZZ_TARGETS="chores routing" pnpm test:native:fuzz
#
# A corpus that grows (#575). Each target keeps its corpus under
# emscripten/build-fuzz/corpus/<name>; CI restores that directory from a cache
# keyed by ISO week (build.yml, native-sanitizers), so a run starts from every
# input earlier runs kept instead of from nothing. Every run also reads the
# committed seeds in emscripten/fuzz-seeds/<name> (scripts/fuzz-seeds.mjs: one
# per finite-or-refused case), read-only, so those are executed cached or cold.
# After the timed run the corpus is minimised (-merge=1: the smallest set of
# inputs with the same coverage) and that is what is saved. The summary line per
# target reports the corpus restored and the edges covered at start and at the
# end — a warm start begins near where the last run finished.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/emscripten/build-fuzz"
SEEDS="$ROOT/emscripten/fuzz-seeds"
TARGETS="${FUZZ_TARGETS:-swe chores forces routing}"
SECONDS_EACH="${FUZZ_SECONDS:-60}"

cmake -S "$ROOT/emscripten" -B "$BUILD" -DWATERSHED_FUZZ=ON -DCMAKE_CXX_COMPILER="${CXX_FUZZ:-clang++}" >/dev/null
for t in $TARGETS; do
    cmake --build "$BUILD" --target "watershed_${t}_fuzz"
done

# "cov: N" of the first line in $1 matching $2 (libFuzzer's INITED / DONE lines).
cov_of() { grep -m1 -E "$2" "$1" | grep -oE 'cov: [0-9]+' | grep -oE '[0-9]+' || echo 0; }

summary=()
for t in $TARGETS; do
    corpus="$BUILD/corpus/$t"
    mkdir -p "$corpus"
    restored=$(find "$corpus" -type f | wc -l | tr -d ' ')
    seeds=()
    [ -d "$SEEDS/$t" ] && seeds=("$SEEDS/$t")
    log="$BUILD/fuzz-$t.log"
    echo "[fuzz] watershed_${t}_fuzz for ${SECONDS_EACH}s (corpus: $restored restored inputs)"
    "$BUILD/watershed_${t}_fuzz" -max_total_time="$SECONDS_EACH" -print_funcs=0 -print_final_stats=1 \
        "$corpus" "${seeds[@]}" 2>&1 | tee "$log"
    start=$(cov_of "$log" 'INITED')
    end=$(cov_of "$log" 'DONE')

    # Minimise before it is saved: same coverage, fewest inputs.
    merged="$BUILD/corpus-merge/$t"
    rm -rf "$merged" && mkdir -p "$merged"
    "$BUILD/watershed_${t}_fuzz" -merge=1 -print_funcs=0 "$merged" "$corpus" "${seeds[@]}" >"$BUILD/merge-$t.log" 2>&1
    rm -rf "$corpus" && mv "$merged" "$corpus"
    kept=$(find "$corpus" -type f | wc -l | tr -d ' ')
    summary+=("$t: restored $restored inputs, cov $start at start -> $end at end, kept $kept after -merge=1")
done
printf '[fuzz] %s\n' "${summary[@]}"
echo "[fuzz] ${TARGETS// /, }: no crash"
