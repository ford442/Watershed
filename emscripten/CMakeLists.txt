cmake_minimum_required(VERSION 3.20)
project(WatershedNative CXX)

# C++20 (#467): std::span / std::bit_cast / [[likely]]. emcc 3.1.56's clang
# and the host toolchains in CI both support it.
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Compute TUs compile on host and WASM. bindings.cpp is WASM-only: the plain
# C ABI (extern "C" ws_* exports). Keep this list in sync with WASM.md.
set(COMPUTE_SOURCES
    forces.cpp
    swe.cpp
    chores.cpp
    particles.cpp
    routing.cpp
    terrain.cpp
)

add_library(watershed_compute STATIC ${COMPUTE_SOURCES})
target_include_directories(watershed_compute PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")

if(EMSCRIPTEN)
    add_executable(watershed_native bindings.cpp)
    target_link_libraries(watershed_native PRIVATE watershed_compute)

    set_target_properties(watershed_native PROPERTIES
        SUFFIX ".js"
    )

    if(NOT CMAKE_BUILD_TYPE)
        set(CMAKE_BUILD_TYPE Release)
    endif()

    # Stack (#502): emcc 3.1.56 defaults to a 64 KiB stack. Release names it so
    # the budget is visible here; Debug gets 256 KiB (-O0 frames are several
    # times larger) and STACK_OVERFLOW_CHECK=2, which checks the stack pointer
    # on every function entry, so an overflow is a named abort instead of the
    # stack silently running into the heap's static data.
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        set(EM_OPT_FLAGS "-O0 -g3 -s ASSERTIONS=2 -s SAFE_HEAP=1 -s STACK_SIZE=256KB -s STACK_OVERFLOW_CHECK=2")
    else()
        set(EM_OPT_FLAGS "-O3 -s ASSERTIONS=0 -s STACK_SIZE=64KB")
    endif()

    # Default production path MUST NOT require SharedArrayBuffer.
    # Threads are a separate opt-in CMake option (build.sh --threads), never default-on.
    # ENVIRONMENT is 'web,worker' on BOTH variants (#454): the Rapier worker loads
    # this same glue (src/physics/workerWasm.ts), and so will the sim worker
    # (#455). A 'web'-only glue hard-codes ENVIRONMENT_IS_WORKER=false and only
    # happened to work because EXPORT_ES6 resolves the .wasm via import.meta.url.
    # Debug adds 'node' (#502): the Debug binary is never shipped, and with it
    # the ws_trapTest path is tested under vitest against a binary that really
    # traps (wasmTrap.integration.test.ts). ASSERTIONS=2 otherwise aborts on node.
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        set(EM_ENVIRONMENT "web,worker,node")
    else()
        set(EM_ENVIRONMENT "web,worker")
    endif()
    option(WATERSHED_THREADS "Enable Emscripten pthreads" OFF)
    if(WATERSHED_THREADS)
        # -pthread at link replaces the deprecated -s USE_PTHREADS=1 (#467).
        set(EM_THREAD_FLAGS "-pthread -s PTHREAD_POOL_SIZE=4 -s ENVIRONMENT='${EM_ENVIRONMENT}'")
    else()
        set(EM_THREAD_FLAGS "-s ENVIRONMENT='${EM_ENVIRONMENT}'")
    endif()

    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        # -msimd128: the SWE stepper (lift, CFL max, 4-wide HLL + hydrostatic
        # reconstruction, gather — #467), particle Euler, chores autovec.
        set(EM_COMPILE_FLAGS
            -O0
            -g3
            # SIMD: the SWE stepper (incl. the HLL faces), Euler in
            # particles.cpp, optional chores.
            -msimd128
            -mbulk-memory
        )
        # -fno-exceptions / -fno-rtti at compile too (#502), as in Release: the
        # Debug binary is the one that reproduces a field trap, so it should
        # be the same language as the shipped one. WATERSHED_TRAP_TEST adds
        # ws_trapTest (bindings.cpp), which ?wasmTrapTest=1 calls (wasmTrap.ts).
        target_compile_options(watershed_compute PRIVATE ${EM_COMPILE_FLAGS} -fno-exceptions -fno-rtti)
        target_compile_options(watershed_native PRIVATE ${EM_COMPILE_FLAGS} -fno-exceptions -fno-rtti)
        target_compile_definitions(watershed_native PRIVATE WATERSHED_TRAP_TEST=1)
        # libc++ hardening: every std::span / std::vector index and every
        # subspan is bounds-checked in the wasm32 build, the one the host
        # _GLIBCXX_ASSERTIONS builds stand in for. emcc 3.1.56 ships libc++ 17,
        # whose all-checks mode is _LIBCPP_ENABLE_DEBUG_MODE; from libc++ 18 it
        # is -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE (switch
        # at the next emcc pin bump). A failed check is a named abort.
        target_compile_definitions(watershed_compute PRIVATE _LIBCPP_ENABLE_DEBUG_MODE=1)
        target_compile_definitions(watershed_native PRIVATE _LIBCPP_ENABLE_DEBUG_MODE=1)
    else()
        # Every TU, bindings.cpp included, is -fno-rtti / -fno-exceptions:
        # the C ABI (#467) has no Embind typeid to match, so nothing needs RTTI.
        # FP model: IEEE, the same as the host build below. No -ffast-math —
        # reassociation and approximate functions made the shipped binary
        # compute different SWE and routing bits from the host goldens, and
        # replays / ghosts need one set of numbers. emscripten/native_digest.h
        # pins host == wasm bit for bit (host_smoke.cpp, and
        # nativeDigest.integration.test.ts on the shipped pair); a flag that
        # breaks it is the wrong flag, not a tolerance to loosen. The hot SWE
        # kernels are hand-vectorised in simdf32.h, so the vectoriser loses
        # little. -ffp-contract=off is explicit, as on the host (wasm32 has no
        # scalar FMA today, but relaxed-SIMD would add one). -fno-math-errno
        # stays: emscripten's libm never sets errno, and without it clang
        # keeps a libcall around sqrt; the result is the same correctly
        # rounded sqrt either way.
        # -flto: six small TUs; lets calculateWaterForce etc. inline across
        # forces.cpp / bindings.cpp. Also passed at link (below).
        set(EM_COMPILE_FLAGS
            -O3
            -ffp-contract=off
            -fno-math-errno
            -flto
            -funroll-loops
            # SIMD: the SWE stepper (incl. the HLL faces, #467), Euler in
            # particles.cpp, optional chores.
            -msimd128
            -mbulk-memory
        )
        target_compile_options(watershed_compute PRIVATE
            ${EM_COMPILE_FLAGS}
            -fno-exceptions
            -fno-rtti
        )
        target_compile_options(watershed_native PRIVATE
            ${EM_COMPILE_FLAGS}
            -fno-exceptions
            -fno-rtti
        )
    endif()

    if(WATERSHED_THREADS)
        target_compile_options(watershed_compute PRIVATE -pthread)
        target_compile_options(watershed_native PRIVATE -pthread)
    endif()

    # Fixed 16 MB heap, no growth. The live data is ~1 MB at most: the
    # largest SWE budget (128x80 cells x 4 planes, 160 KiB) plus its solver
    # and scroll scratch (~0.5 MB, sized up front by
    # reserveShallowWaterScratch), particle SoAs (36 B per particle), the
    # routing chain, one terrain tile in flight (a 40x96 visual tile is
    # 109 KiB) and chore scratch; plus 64 KiB of stack and the static data.
    # 16 MB is >10x that. Growth was the only reason every TS heap view had
    # to be rebound (#415): it replaced the ArrayBuffer and silently detached
    # views made before it. With a fixed heap a view made at bind or
    # allocation time stays valid for the module's life.
    # ABORTING_MALLOC defaults to 1 without growth (a failed malloc aborts the
    # module); 0 keeps malloc returning NULL, which the TS binding turns into
    # WasmHeapExhaustedError — the over-budget signal.
    math(EXPR INITIAL_MEMORY_BYTES "16 * 1024 * 1024")

    if(NOT CMAKE_BUILD_TYPE STREQUAL "Debug")
        # -flto at link matches the compile flag above; --closure 1 minifies
        # the glue (_ws_* / HEAP* / createWatershedNative are exported names
        # and survive it).
        #
        # --emit-symbol-map (#502, linked below for both variants): a release trap reads `wasm-function[N]` (no
        # name section ships). The map is `N:name` per line, written next to the
        # glue as watershed_native.js.symbols; build.sh moves it out of public/
        # (emscripten/watershed_native.symbols, committed with the pair) and Vite
        # copies it into build-sourcemaps/ next to the JS maps (#465 B).
        # scripts/wasm-symbolicate.mjs maps a field stack with it.
        # -sSTRICT: no deprecated settings or implicit legacy runtime exports;
        # everything the loader uses is named on the link line below. STRICT also
        # stops assuming a main(): --no-entry says there is none.
        target_link_options(watershed_native PRIVATE "SHELL:-flto" "SHELL:--closure 1" "SHELL:-s STRICT=1" "SHELL:--no-entry")
    endif()

    # No FILESYSTEM: nothing touches files. emmalloc: a handful of long-lived
    # grid / SoA blocks, so the small allocator beats dlmalloc on size.
    # DYNAMIC_EXECUTION=0: the glue may not eval / new Function — the CSP
    # claim (script-src 'self' 'wasm-unsafe-eval', WASM.md) checked at link
    # time. SUPPORT_LONGJMP=0: no setjmp, so no longjmp runtime can be linked.
    # Both are byte-for-byte no-ops on today's pair; they make a future need
    # for either a link error instead of a silent change. (SUPPORT_ERRNO=0 is
    # deprecated and a no-op in emcc 3.1.56: its setErrNo library is gone.)
    target_link_options(watershed_native PRIVATE
        "SHELL:${EM_OPT_FLAGS}"
        "SHELL:-s WASM_BIGINT=1"
        "SHELL:-s FILESYSTEM=0"
        "SHELL:-s DYNAMIC_EXECUTION=0"
        "SHELL:-s SUPPORT_LONGJMP=0"
        "SHELL:-s MALLOC=emmalloc"
        "SHELL:-s ALLOW_MEMORY_GROWTH=0"
        "SHELL:-s ABORTING_MALLOC=0"
        "SHELL:-s INITIAL_MEMORY=${INITIAL_MEMORY_BYTES}"
        "SHELL:-s EXPORTED_RUNTIME_METHODS=HEAPF32,HEAP32,HEAPU8"
        # The Module options wasmLoader.ts passes (#467). Named explicitly: emcc
        # 4.x+ dropped wasmBinary from the default list, so without this a newer
        # glue silently ignores the verified bytes and fetches the wasm again.
        "SHELL:-s INCOMING_MODULE_JS_API=wasmBinary,locateFile"
        "SHELL:-s EXPORT_ES6=1"
        "SHELL:-s MODULARIZE=1"
        "SHELL:-s EXPORT_NAME='createWatershedNative'"
        # No --bind (#467): the ws_* exports are EMSCRIPTEN_KEEPALIVE C functions,
        # bound in TS from the wasmAbi.ts table. -fno-rtti at link too.
        "SHELL:-fno-rtti"
        # Both variants (#502): Debug's own map lets the symbolicate path be
        # tested against a binary that really traps (ws_trapTest).
        "SHELL:--emit-symbol-map"
        "SHELL:${EM_THREAD_FLAGS}"
    )

    set(WATERSHED_OUTPUT_DIR "${CMAKE_SOURCE_DIR}/../public" CACHE PATH "Directory for watershed_native.js/.wasm")
    set_target_properties(watershed_native PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${WATERSHED_OUTPUT_DIR}"
    )
else()
    # Native host build — clangd / host smoke. No -s flags, no -ffast-math.
    # -ffp-contract=off keeps FMA contraction out of the golden path so
    # host_smoke.cpp results stay bit-reproducible; see the FP contract note
    # on the Emscripten branch above (#404).
    add_executable(watershed_host_smoke host_smoke.cpp)
    target_link_libraries(watershed_host_smoke PRIVATE watershed_compute)
    target_compile_options(watershed_compute PRIVATE -O2 -Wall -Wextra -ffp-contract=off)
    target_compile_options(watershed_host_smoke PRIVATE -O2 -Wall -Wextra -ffp-contract=off)

    # #467: the C ABI trusts JS for every pointer and width * height. Host-only
    # checks for that trust:
    #   WATERSHED_SANITIZE=ON  host smoke under ASan + UBSan (pnpm test:native:sanitize)
    #   WATERSHED_FUZZ=ON      libFuzzer targets over every entry-point family —
    #                          swe, chores, forces (+ particles), routing, terrain
    #                          (clang; pnpm test:native:fuzz). Implies the sanitizers.
    option(WATERSHED_SANITIZE "Host build with -fsanitize=address,undefined" OFF)
    option(WATERSHED_FUZZ "Build the libFuzzer targets (clang only)" OFF)
    if(WATERSHED_SANITIZE OR WATERSHED_FUZZ)
        # _GLIBCXX_ASSERTIONS bounds-checks std::span / vector indexing.
        set(WATERSHED_SAN_FLAGS -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer -g
            -D_GLIBCXX_ASSERTIONS)
        target_compile_options(watershed_compute PRIVATE ${WATERSHED_SAN_FLAGS})
        target_compile_options(watershed_host_smoke PRIVATE ${WATERSHED_SAN_FLAGS})
        target_link_options(watershed_host_smoke PRIVATE ${WATERSHED_SAN_FLAGS})
    endif()
    if(WATERSHED_FUZZ)
        if(NOT CMAKE_CXX_COMPILER_ID MATCHES "Clang")
            message(FATAL_ERROR "WATERSHED_FUZZ needs clang (libFuzzer): -DCMAKE_CXX_COMPILER=clang++")
        endif()
        target_compile_options(watershed_compute PRIVATE -fsanitize=fuzzer-no-link)
        # One target per entry-point family (#502); pnpm test:native:fuzz runs each.
        foreach(fuzz_target swe chores forces routing terrain)
            add_executable(watershed_${fuzz_target}_fuzz ${fuzz_target}_fuzz.cpp)
            target_link_libraries(watershed_${fuzz_target}_fuzz PRIVATE watershed_compute)
            target_compile_options(watershed_${fuzz_target}_fuzz PRIVATE
                -O1 -ffp-contract=off -fsanitize=fuzzer ${WATERSHED_SAN_FLAGS})
            target_link_options(watershed_${fuzz_target}_fuzz PRIVATE -fsanitize=fuzzer ${WATERSHED_SAN_FLAGS})
        endforeach()
    endif()

    # Copy compile_commands.json next to the sources so clangd finds it without
    # a .clangd CompilationDatabase. WASM configures must not overwrite this
    # (they write emscripten/build/compile_commands.json only), and neither do
    # the sanitizer / fuzz trees.
    if(NOT WATERSHED_SANITIZE AND NOT WATERSHED_FUZZ)
        add_custom_target(sync_compile_commands ALL
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${CMAKE_BINARY_DIR}/compile_commands.json"
                "${CMAKE_SOURCE_DIR}/compile_commands.json"
            COMMENT "Sync host compile_commands.json for clangd"
        )
    endif()
endif()
