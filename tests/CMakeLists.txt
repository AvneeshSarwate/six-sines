# And finally the test suite
add_executable(six-sines-test
		test_main.cpp

		structure.cpp
		factory_patches.cpp
		output_stage_dsp.cpp
		engine_facade.cpp
		macro_per_note_mod.cpp
		mpe_smoothing.cpp
		patch_sync.cpp
		preset_jog.cpp
)

target_link_libraries(six-sines-test
		fmt
		six-sines-impl
		six-sines-headless
		catch2
		six-sines-patches

        )

if (WIN32)
	if ("${CMAKE_BUILD_TYPE}" STREQUAL "Debug")
		target_link_libraries(six-sines-test DbgHelp.lib)
	endif()
endif()

# A deliberately independent, dynamic CLAP boundary test. It does not link six-sines-impl: it
# loads the built bundle through clap_entry, schedules two same-key note IDs plus PARAM_MOD events,
# and verifies metadata, note isolation, timing, audio, and state immutability without a DAW or
# audio device.
add_executable(six-sines-clap-reference
		clap_macro_mod_reference.cpp
)
target_link_libraries(six-sines-clap-reference PRIVATE clap ${CMAKE_DL_LIBS})
if (APPLE)
	# Synth construction uses the macOS documents-folder APIs. Keep their autoreleased Cocoa
	# objects alive correctly while the dynamically loaded plugin is constructed and rendered.
	set_source_files_properties(clap_macro_mod_reference.cpp PROPERTIES LANGUAGE OBJCXX)
	target_link_libraries(six-sines-clap-reference PRIVATE "-framework Foundation")
endif()
add_dependencies(six-sines-clap-reference six-sines_clap)

if (APPLE)
	set(SIX_SINES_CLAP_REFERENCE_PATH "$<TARGET_BUNDLE_DIR:six-sines_clap>")
else()
	set(SIX_SINES_CLAP_REFERENCE_PATH "$<TARGET_FILE:six-sines_clap>")
endif()

add_custom_target(six-sines-check-clap-macro-mod
		COMMAND six-sines-clap-reference "${SIX_SINES_CLAP_REFERENCE_PATH}"
		DEPENDS six-sines-clap-reference six-sines_clap
		WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
		USES_TERMINAL
		VERBATIM
)


# Performance benchmark target. Built only when explicitly requested
# (cmake --build … --target six-sines-perf). Not in any default aggregate,
# so day-to-day builds are untouched.
#
# Run a Release build for meaningful numbers:
#   cmake -B cmake-build-perf -DCMAKE_BUILD_TYPE=Release -GNinja
#   cmake --build cmake-build-perf --target six-sines-perf
#   ./cmake-build-perf/tests/six-sines-perf
#
# Filter scenarios with Catch2 tags, e.g. "[scn:8v_dense]" or "[bench][plugin]".
add_executable(six-sines-perf
		perf_main.cpp
		perf_scenarios.cpp
)

target_link_libraries(six-sines-perf
		fmt
		six-sines-impl
		catch2
		six-sines-patches
)

if (WIN32)
	if ("${CMAKE_BUILD_TYPE}" STREQUAL "Debug")
		target_link_libraries(six-sines-perf DbgHelp.lib)
	endif()
endif()
