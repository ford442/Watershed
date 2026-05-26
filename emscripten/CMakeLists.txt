cmake_minimum_required(VERSION 3.20)
project(WatershedNative CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---------------------------------------------------------------------------
# Source files
# ---------------------------------------------------------------------------
set(SOURCES main.cpp)

# ---------------------------------------------------------------------------
# Output target
# ---------------------------------------------------------------------------
add_executable(watershed_native ${SOURCES})

# ---------------------------------------------------------------------------
# Emscripten-specific configuration (active when using: emcmake cmake ..)
# ---------------------------------------------------------------------------
if(EMSCRIPTEN)
    set_target_properties(watershed_native PROPERTIES
        SUFFIX ".js"
    )

    # Build type defaults
    if(NOT CMAKE_BUILD_TYPE)
        set(CMAKE_BUILD_TYPE Release)
    endif()

    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        set(EM_OPT_FLAGS "-O0 -g3 -s ASSERTIONS=2 -s SAFE_HEAP=1")
    else()
        set(EM_OPT_FLAGS "-O3 -s ASSERTIONS=0")
    endif()

    # Threaded build option: cmake -DWATERSHED_THREADS=ON ..
    option(WATERSHED_THREADS "Enable Emscripten pthreads" OFF)
    if(WATERSHED_THREADS)
        set(EM_THREAD_FLAGS "-s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s ENVIRONMENT='web,worker'")
    else()
        set(EM_THREAD_FLAGS "-s ENVIRONMENT='web'")
    endif()

    target_compile_options(watershed_native PRIVATE
        -msimd128
        -ffast-math
        -fno-exceptions
        -fno-rtti
        -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0
        -funroll-loops
        -mbulk-memory
    )

    # Initial WASM heap: 64 MB (grows via ALLOW_MEMORY_GROWTH)
    math(EXPR INITIAL_MEMORY_BYTES "64 * 1024 * 1024")

    target_link_options(watershed_native PRIVATE
        "SHELL:${EM_OPT_FLAGS}"
        "SHELL:-s WASM=1"
        "SHELL:-s WASM_BIGINT=1"
        "SHELL:-s ALLOW_MEMORY_GROWTH=1"
        "SHELL:-s INITIAL_MEMORY=${INITIAL_MEMORY_BYTES}"
        "SHELL:-s EXPORT_ES6=1"
        "SHELL:-s MODULARIZE=1"
        "SHELL:-s EXPORT_NAME='createWatershedNative'"
        "SHELL:--bind"
        "SHELL:${EM_THREAD_FLAGS}"
    )
else()
    # Native host build (unit tests, CI)
    target_compile_options(watershed_native PRIVATE -O2 -Wall -Wextra)
endif()
