# Six Sines portable WebAssembly engine.
#
# This file intentionally does not include libs/CMakeLists.txt: that desktop graph adds JUCE,
# clap-wrapper, VST3/AUv2/standalone support, RtAudio, and RtMidi. Add only the libraries used by
# the DSP/state core.

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "SIX_SINES_WEB_ENGINE_ONLY currently requires the Emscripten toolchain")
endif()

# Homebrew's Emscripten package does not ship clang-scan-deps. The project does not use C++20
# modules, so dependency scanning is unnecessary and would only make Ninja call the missing tool.
set(CMAKE_CXX_SCAN_FOR_MODULES OFF)

add_subdirectory(libs/clap-libs/clap EXCLUDE_FROM_ALL)
add_subdirectory(libs/fmt EXCLUDE_FROM_ALL)

add_library(simde INTERFACE)
target_include_directories(simde INTERFACE libs/simde)

add_subdirectory(libs/sst/sst-cpputils EXCLUDE_FROM_ALL)
add_subdirectory(libs/sst/sst-basic-blocks EXCLUDE_FROM_ALL)
add_subdirectory(libs/sst/sst-voicemanager EXCLUDE_FROM_ALL)
add_subdirectory(libs/sst/sst-filters EXCLUDE_FROM_ALL)

set(SST_PLUGININFRA_PROVIDE_TINYXML ON CACHE BOOL "Provide TinyXML" FORCE)
set(SST_PLUGININFRA_PROVIDE_PATCHBASE ON CACHE BOOL "Provide PatchBase" FORCE)
set(SST_PLUGININFRA_PROVIDE_MINIZ OFF CACHE BOOL "No archive filesystem in the web engine" FORCE)
set(SST_PLUGININFRA_BUILD_TESTS OFF CACHE BOOL "No dependency tests in the web engine" FORCE)
add_subdirectory(libs/sst/sst-plugininfra EXCLUDE_FROM_ALL)

add_subdirectory(libs/libsamplerate EXCLUDE_FROM_ALL)

add_library(six-sines-core STATIC
        src/dsp/sintable.cpp
        src/synth/synth.cpp
        src/synth/voice.cpp
        src/synth/patch.cpp
        src/synth/mod_matrix.cpp
        src/synth/macro_usage.cpp
)
target_include_directories(six-sines-core PUBLIC src)
target_compile_definitions(six-sines-core PUBLIC SIX_SINES_PORTABLE=1)
target_compile_definitions(six-sines-core PUBLIC
        SIX_SINES_PORT_BUILD_ID="${SIX_SINES_PORT_SOURCE_ID}")
target_compile_options(six-sines-core PUBLIC -msimd128)
target_link_libraries(six-sines-core PUBLIC
        clap
        simde
        fmt-header-only
        sst-basic-blocks sst-voicemanager sst-cpputils sst-filters
        sst-plugininfra::tinyxml
        sst-plugininfra::patchbase
        sst-plugininfra::version_information
        samplerate
)

add_executable(six-sines-web
        src/headless/engine_facade.cpp
)
target_include_directories(six-sines-web PRIVATE src)
target_compile_definitions(six-sines-web PRIVATE SIX_SINES_PORTABLE=1)
target_compile_options(six-sines-web PRIVATE -msimd128)
target_link_libraries(six-sines-web PRIVATE six-sines-core)
set_target_properties(six-sines-web PROPERTIES
        OUTPUT_NAME "six-sines"
        SUFFIX ".js"
)

target_link_options(six-sines-web PRIVATE
        -msimd128
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        # AudioWorkletGlobalScope is neither Window nor WorkerGlobalScope. Supplying wasmBinary
        # means the shell fallback needs no file APIs, and including shell lets Emscripten run in
        # that standards-defined global scope.
        "-sENVIRONMENT=web,worker,node,shell"
        "-sFILESYSTEM=0"
        "-sALLOW_MEMORY_GROWTH=1"
        "-sINITIAL_MEMORY=67108864"
        "-sSTACK_SIZE=1048576"
        "-sINCOMING_MODULE_JS_API=['wasmBinary']"
        "-sASSERTIONS=1"
        "-sEXPORTED_FUNCTIONS=['_sx_event_sizeof','_sx_param_info_sizeof','_sx_get_build_id','_sx_create','_sx_destroy','_sx_load_preset_utf8','_sx_get_param_count','_sx_get_param_info','_sx_process','_malloc','_free']"
        "-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPF32','UTF8ToString']"
)

configure_file(web/six-sines-worklet.js six-sines-worklet.js COPYONLY)
configure_file(web/six-sines-node.js six-sines-node.js COPYONLY)
configure_file(web/six-sines-node.d.ts six-sines-node.d.ts COPYONLY)
configure_file(web/browser-smoke.html browser-smoke.html COPYONLY)
configure_file(web/browser-smoke.js browser-smoke.js COPYONLY)
configure_file(web/browser-realtime-smoke.html browser-realtime-smoke.html COPYONLY)
configure_file(web/browser-realtime-smoke.js browser-realtime-smoke.js COPYONLY)
configure_file(web/browser-realtime-hardening.html browser-realtime-hardening.html COPYONLY)
configure_file(web/browser-realtime-hardening.js browser-realtime-hardening.js COPYONLY)
configure_file("resources/factory_patches/Templates/INIT Sine.sxsnp" init.sxsnp COPYONLY)
configure_file("resources/factory_patches/Bass/Warrior Macros.sxsnp"
        realtime-replacement.sxsnp COPYONLY)

find_program(SIX_SINES_NODE_EXECUTABLE node)
if(SIX_SINES_NODE_EXECUTABLE)
    add_custom_target(six-sines-check-web-direct
            COMMAND "${SIX_SINES_NODE_EXECUTABLE}"
                    "${CMAKE_CURRENT_SOURCE_DIR}/web/direct-wasm-smoke.mjs"
                    "$<TARGET_FILE:six-sines-web>"
                    "${CMAKE_CURRENT_SOURCE_DIR}/resources/factory_patches/Templates/INIT Sine.sxsnp"
                    128
            DEPENDS six-sines-web
            WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
            USES_TERMINAL
            VERBATIM
    )
    add_custom_target(six-sines-check-web-presets
            COMMAND "${SIX_SINES_NODE_EXECUTABLE}"
                    "${CMAKE_CURRENT_SOURCE_DIR}/web/preset-corpus-smoke.mjs"
                    "$<TARGET_FILE:six-sines-web>"
                    "${CMAKE_CURRENT_SOURCE_DIR}/resources/factory_patches"
            DEPENDS six-sines-web
            WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
            USES_TERMINAL
            VERBATIM
    )
    add_custom_target(six-sines-check-web-96k
            COMMAND "${SIX_SINES_NODE_EXECUTABLE}"
                    "${CMAKE_CURRENT_SOURCE_DIR}/web/preset-corpus-smoke.mjs"
                    "$<TARGET_FILE:six-sines-web>"
                    "${CMAKE_CURRENT_SOURCE_DIR}/resources/factory_patches"
                    96000
            DEPENDS six-sines-web
            WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
            USES_TERMINAL
            VERBATIM
    )
    add_custom_target(six-sines-check-web
            DEPENDS six-sines-check-web-direct six-sines-check-web-presets
                    six-sines-check-web-96k)
endif()
