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

    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        set(EM_OPT_FLAGS "-O0 -g3 -s ASSERTIONS=2 -s SAFE_HEAP=1")
    else()
        set(EM_OPT_FLAGS "-O3 -s ASSERTIONS=0")
    endif()

    # Default production path MUST NOT require SharedArrayBuffer.
    # Threads are a separate opt-in CMake option (build.sh --threads), never default-on.
    # ENVIRONMENT is 'web,worker' on BOTH variants (#454): the Rapier worker loads
    # this same glue (src/physics/workerWasm.ts), and so will the sim worker
    # (#455). A 'web'-only glue hard-codes ENVIRONMENT_IS_WORKER=false and only
    # happened to work because EXPORT_ES6 resolves the .wasm via import.meta.url.
    option(WATERSHED_THREADS "Enable Emscripten pthreads" OFF)
    if(WATERSHED_THREADS)
        # -pthread at link replaces the deprecated -s USE_PTHREADS=1 (#467).
        set(EM_THREAD_FLAGS "-pthread -s PTHREAD_POOL_SIZE=4 -s ENVIRONMENT='web,worker'")
    else()
        set(EM_THREAD_FLAGS "-s ENVIRONMENT='web,worker'")
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
        target_compile_options(watershed_compute PRIVATE ${EM_COMPILE_FLAGS})
        target_compile_options(watershed_native PRIVATE ${EM_COMPILE_FLAGS})
    else()
        # Every TU, bindings.cpp included, is -fno-rtti / -fno-exceptions:
        # the C ABI (#467) has no Embind typeid to match, so nothing needs RTTI.
        # FP contract (#404): the WASM Release build keeps -ffast-math while the
        # host build below uses -ffp-contract=off. The two are deliberately not
        # identical — the shipped binary wants the vectoriser, the host smoke
        # wants reproducible goldens. This is safe only as long as the goldens
        # agree across both: emscripten/host_smoke.cpp (host) and the SWE /
        # applySWEEvent blocks in emscripten/smoke_test.mjs (wasm) assert the
        # same well-balanced and source-term results, the latter against the TS
        # twin within 1e-5. If those ever diverge, drop -ffast-math here (or at
        # least add -ffp-contract=off on the HLL TU in swe.cpp) rather than
        # loosening the tolerance.
        # -fno-finite-math-only (#454): -ffast-math implies finite-math-only,
        # which lets clang fold every std::isfinite() to true — including the
        # NaN guards in chores.cpp that keep NaN out of the HUD histogram /
        # reduce chores. Keep the rest of fast-math (reassociation for the
        # vectoriser) but let isfinite / isnan mean what they say.
        # -flto: six small TUs; lets calculateWaterForce etc. inline across
        # forces.cpp / bindings.cpp. Also passed at link (below).
        set(EM_COMPILE_FLAGS
            -O3
            -ffast-math
            -fno-finite-math-only
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

    # 16 MB (#454): the module heap-allocates about 1 MB at most (largest SWE
    # budget is 128x80 cells x 4 planes plus ~0.5 MB of solver scratch, particle
    # SoA, chore scratch), and
    # reserveShallowWaterScratch() sizes the solver scratch up front, so the heap
    # does not grow mid-step. Growth stays enabled as a safety valve; callers
    # still rebind views through heapF32() (#415).
    math(EXPR INITIAL_MEMORY_BYTES "16 * 1024 * 1024")
    math(EXPR MAXIMUM_MEMORY_BYTES "256 * 1024 * 1024")

    if(NOT CMAKE_BUILD_TYPE STREQUAL "Debug")
        # -flto at link matches the compile flag above; --closure 1 minifies
        # the glue (_ws_* / HEAP* / createWatershedNative are exported names
        # and survive it).
        target_link_options(watershed_native PRIVATE "SHELL:-flto" "SHELL:--closure 1")
    endif()

    # No FILESYSTEM: nothing touches files. emmalloc: a handful of long-lived
    # grid / SoA blocks, so the small allocator beats dlmalloc on size.
    target_link_options(watershed_native PRIVATE
        "SHELL:${EM_OPT_FLAGS}"
        "SHELL:-s WASM_BIGINT=1"
        "SHELL:-s FILESYSTEM=0"
        "SHELL:-s MALLOC=emmalloc"
        "SHELL:-s ALLOW_MEMORY_GROWTH=1"
        "SHELL:-s INITIAL_MEMORY=${INITIAL_MEMORY_BYTES}"
        "SHELL:-s MAXIMUM_MEMORY=${MAXIMUM_MEMORY_BYTES}"
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
    #   WATERSHED_FUZZ=ON      libFuzzer target over the SWE entry points (clang;
    #                          pnpm test:native:fuzz). Implies the sanitizers.
    option(WATERSHED_SANITIZE "Host build with -fsanitize=address,undefined" OFF)
    option(WATERSHED_FUZZ "Build the libFuzzer SWE target (clang only)" OFF)
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
        add_executable(watershed_swe_fuzz swe_fuzz.cpp)
        target_link_libraries(watershed_swe_fuzz PRIVATE watershed_compute)
        target_compile_options(watershed_compute PRIVATE -fsanitize=fuzzer-no-link)
        target_compile_options(watershed_swe_fuzz PRIVATE -O1 -ffp-contract=off -fsanitize=fuzzer ${WATERSHED_SAN_FLAGS})
        target_link_options(watershed_swe_fuzz PRIVATE -fsanitize=fuzzer ${WATERSHED_SAN_FLAGS})
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
