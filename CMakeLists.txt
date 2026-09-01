cmake_minimum_required(VERSION 3.28)

set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(CMAKE_OSX_DEPLOYMENT_TARGET 10.15 CACHE STRING "Build for 10.14")
set(CMAKE_POSITION_INDEPENDENT_CODE ON)


project(six-sines VERSION 1.2.0 LANGUAGES C CXX)
set(PRODUCT_NAME "Six Sines")


option(USE_SANITIZER "Build and link with ASAN" FALSE)
option(COPY_AFTER_BUILD "Will copy after build" TRUE)
option(BUILD_SINGLE_ONLY "Only build the one plugin - no seven sines out" FALSE)
option(SIX_SINES_WEB_ENGINE_ONLY "Build only the portable Emscripten engine" FALSE)
option(SIX_SINES_PAIRED_BUILD "Identify native and browser artifacts as one source build" FALSE)

include(cmake/compile-options.cmake)

## New version
include(libs/sst/sst-plugininfra/cmake/git-version-functions.cmake)
version_from_versionfile_or_git()
set(SIX_SINES_PORT_SOURCE_ID "${GIT_COMMIT_HASH}")
if(SIX_SINES_PAIRED_BUILD)
    execute_process(COMMAND git rev-parse --short=12 HEAD
            WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
            OUTPUT_VARIABLE SIX_SINES_PORT_SOURCE_ID
            OUTPUT_STRIP_TRAILING_WHITESPACE
            COMMAND_ERROR_IS_FATAL ANY)
    execute_process(COMMAND git status --porcelain --untracked-files=normal
            WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
            OUTPUT_VARIABLE SIX_SINES_PORT_DIRTY
            OUTPUT_STRIP_TRAILING_WHITESPACE
            COMMAND_ERROR_IS_FATAL ANY)
    if(SIX_SINES_PORT_DIRTY)
        string(APPEND SIX_SINES_PORT_SOURCE_ID "-dirty")
    endif()
    set(GIT_COMMIT_HASH "${SIX_SINES_PORT_SOURCE_ID}")
    set(GIT_BRANCH "browser-audio-worklet")
    set(GIT_IMPLIED_DISPLAY_VERSION "Browser Port ${SIX_SINES_PORT_SOURCE_ID}")
endif()
message(STATUS "DISPLAY_VERSION=${GIT_IMPLIED_DISPLAY_VERSION}; COMMIT_HASH=${GIT_COMMIT_HASH}; BRANCH=${GIT_BRANCH}")
configure_file(web/build-manifest.json.in six-sines-build.json @ONLY)

if(EMSCRIPTEN OR SIX_SINES_WEB_ENGINE_ONLY)
    include(cmake/web-engine.cmake)
    return()
endif()


include(cmake/CmakeRC.cmake)
file(GLOB_RECURSE PATCHES  "resources/factory_patches/*.sxsnp")
cmrc_add_resource_library(${PROJECT_NAME}-patches NAMESPACE sixsines_patches ${PATCHES})

file(GLOB THEMES "resources/factory_themes/*.sixtheme")
cmrc_add_resource_library(${PROJECT_NAME}-themes NAMESPACE sixsines_themes ${THEMES})

file(GLOB FONTS
        "resources/fonts/Manrope/static/*.ttf"
        "resources/fonts/Anonymous_Pro/*.ttf")
# The fonts library also carries the about-screen assets (icon + acknowledgements)
# so we don't need a separate cmrc target for two files.
cmrc_add_resource_library(${PROJECT_NAME}-fonts NAMESPACE sixsines_fonts
        ${FONTS}
        resources/icon/SixSinesIcon.png
        doc/ack.md)

set(JUCE_PATH "${CMAKE_SOURCE_DIR}/libs/JUCE")
add_subdirectory(libs)

# DSP, state, and voice engine only. Keep this target free of JUCE, plugin wrappers, UI sources,
# embedded preset/theme resources, and editor dependencies: it is the source set shared by the
# native plugin and the browser build.
add_library(${PROJECT_NAME}-core STATIC
        src/dsp/sintable.cpp

        src/synth/synth.cpp
        src/synth/voice.cpp
        src/synth/patch.cpp
        src/synth/mod_matrix.cpp
        src/synth/macro_usage.cpp
)
target_include_directories(${PROJECT_NAME}-core PUBLIC src)
target_compile_definitions(${PROJECT_NAME}-core PUBLIC
        SIX_SINES_PORT_BUILD_ID="${SIX_SINES_PORT_SOURCE_ID}")
target_link_libraries(${PROJECT_NAME}-core PUBLIC
        clap
        simde
        mts-esp-client
        fmt-header-only
        sst-basic-blocks sst-voicemanager sst-cpputils sst-filters
        sst-plugininfra
        sst-plugininfra::filesystem
        sst-plugininfra::tinyxml
        sst-plugininfra::strnatcmp
        sst-plugininfra::patchbase
        sst-plugininfra::version_information
        samplerate
)

add_library(${PROJECT_NAME}-impl STATIC
        src/clap/six-sines-clap.cpp
        src/clap/six-sines-clap-entry-impl.cpp
        src/clap/preset-discovery-impl.cpp

        src/ui/six-sines-editor.cpp
        src/ui/about-screen.cpp
        src/ui/spectrum-analyzer.cpp

        src/ui/clipboard.cpp
        src/ui/main-panel.cpp
        src/ui/main-sub-panel.cpp
        src/ui/matrix-panel.cpp
        src/ui/matrix-sub-panel.cpp
        src/ui/self-sub-panel.cpp
        src/ui/mixer-panel.cpp
        src/ui/mixer-sub-panel.cpp
        src/ui/source-panel.cpp
        src/ui/source-sub-panel.cpp
        src/ui/segmented-ratio-editor.cpp
        src/ui/macro-panel.cpp
        src/ui/macro-sub-panel.cpp
        src/ui/finetune-sub-panel.cpp
        src/ui/mainpan-sub-panel.cpp
        src/ui/playmode-sub-panel.cpp
        src/ui/settings-panel.cpp

        src/presets/preset-manager.cpp
        src/presets/ui-theme-manager.cpp

)
target_include_directories(${PROJECT_NAME}-impl PUBLIC src)
target_compile_definitions(${PROJECT_NAME}-impl PRIVATE
        PRODUCT_NAME="${PRODUCT_NAME}"
)

if (${BUILD_SINGLE_ONLY})
    message(STATUS "Building single plugin version only")
    target_compile_definitions(${PROJECT_NAME}-impl PRIVATE
            CLAP_PLUGIN_COUNT=1
    )
endif()

if (WIN32)
    message(STATUS "Activating wchar presets")
    target_compile_definitions(${PROJECT_NAME}-impl PUBLIC USE_WCHAR_PRESET=1)
endif()

target_link_libraries(${PROJECT_NAME}-impl PUBLIC
        ${PROJECT_NAME}-core
)
target_link_libraries(${PROJECT_NAME}-impl PUBLIC  # PW change to public since we now have tests
        clap-helpers clap-wrapper-extensions
        sst-jucegui
        sst::clap_juce_shim sst::clap_juce_shim_headers
        juce::juce_dsp
        ${PROJECT_NAME}-patches
        ${PROJECT_NAME}-themes
        ${PROJECT_NAME}-fonts
)

target_compile_definitions(clap-wrapper-compile-options-public INTERFACE CLAP_WRAPPER_LOGLEVEL=0)

# CLAP-shaped, UI-free public boundary. This is a separate target so native tests and the
# Emscripten build can share the facade without making the desktop plugin depend on it.
add_library(${PROJECT_NAME}-headless STATIC
        src/headless/engine_facade.cpp
)
target_include_directories(${PROJECT_NAME}-headless PUBLIC src)
target_link_libraries(${PROJECT_NAME}-headless PUBLIC ${PROJECT_NAME}-core)

make_clapfirst_plugins(
        TARGET_NAME ${PROJECT_NAME}
        IMPL_TARGET ${PROJECT_NAME}-impl

        OUTPUT_NAME "${PRODUCT_NAME}"

        ENTRY_SOURCE src/clap/six-sines-clap-entry.cpp

        BUNDLE_IDENTIFER "org.baconpaul.six-sines"
        BUNDLE_VERSION ${PROJECT_VERSION}

        COPY_AFTER_BUILD ${COPY_AFTER_BUILD}

        PLUGIN_FORMATS CLAP VST3 AUV2

        ASSET_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/${PROJECT_NAME}_assets

        WINDOWS_FOLDER_VST3 TRUE

        # You can add a target-per-standalone you want. Syntax here is
        #   target-postfix output-name clap-id
        # This allows you to make multiple standalones from a multi-plugin clap
        STANDALONE_CONFIGURATIONS
            standalone "${PRODUCT_NAME}" "org.baconpaul.six-sines"

        STANDALONE_MACOS_ICON "${CMAKE_SOURCE_DIR}/resources/installer_mac/SixSinesIcon.icns"
        STANDALONE_WINDOWS_ICON "${CMAKE_SOURCE_DIR}/resources/icon/SixSinesIcon.ico"
)


include(cmake/basic_installer_clapfirst.cmake)
add_clapfirst_installer(
        INSTALLER_TARGET ${PROJECT_NAME}-installer
        ASSET_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/${PROJECT_NAME}_assets
        INSTALLER_PREFIX "six-sines"
        PRODUCT_NAME "${PRODUCT_NAME}"
        TARGETS
        ${PROJECT_NAME}_clap
        ${PROJECT_NAME}_vst3
        ${PROJECT_NAME}_auv2
        ${PROJECT_NAME}_standalone
)

add_subdirectory(tests EXCLUDE_FROM_ALL)
