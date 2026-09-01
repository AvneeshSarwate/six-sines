#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_dir="$(cd "$script_dir/.." && pwd)"
output_root="${1:-$source_dir/build/browser-port}"
native_build="$output_root/native"
web_build="$output_root/web"
package_dir="$output_root/package"
em_cache="${EM_CACHE:-$output_root/emscripten-cache}"
native_platform_args=()

for command in cmake emcmake ninja node; do
    command -v "$command" >/dev/null || {
        echo "Required command is missing: $command" >&2
        exit 1
    }
done

# Some Command Line Tools installations keep libc++ only inside the SDK while clang's implicit
# search path still points at the now-empty non-SDK directory. Make the active SDK explicit so a
# clean build has the same standard-library view as an IDE-configured build.
if [[ "$(uname -s)" == "Darwin" ]]; then
    macos_sdk="$(xcrun --sdk macosx --show-sdk-path)"
    libcxx_include="$macos_sdk/usr/include/c++/v1"
    native_platform_args+=(
        "-DCMAKE_CXX_FLAGS=-isystem $libcxx_include"
        "-DCMAKE_OBJCXX_FLAGS=-isystem $libcxx_include"
    )
fi

cmake -S "$source_dir" -B "$native_build" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SINGLE_ONLY=ON \
    -DCOPY_AFTER_BUILD=OFF \
    -DSIX_SINES_PAIRED_BUILD=ON \
    "${native_platform_args[@]}"
cmake --build "$native_build" --target six-sines-test six-sines-clap-reference --parallel

native_test="$native_build/tests/six-sines-test"
native_runner="$native_build/tests/six-sines-clap-reference"
if [[ "$(uname -s)" == "Darwin" ]]; then
    clap_artifact="$native_build/six-sines_assets/Six Sines.clap"
else
    clap_artifact="$native_build/six-sines_assets/Six Sines.clap"
fi

"$native_test"
"$native_runner" "$clap_artifact"

mkdir -p "$em_cache"
EM_CACHE="$em_cache" emcmake cmake -S "$source_dir" -B "$web_build" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DSIX_SINES_WEB_ENGINE_ONLY=ON \
    -DSIX_SINES_PAIRED_BUILD=ON
EM_CACHE="$em_cache" cmake --build "$web_build" --target six-sines-check-web --parallel

node "$source_dir/web/native-wasm-parity.mjs" \
    "$native_runner" "$clap_artifact" "$web_build/six-sines.js" "$source_dir"
node "$source_dir/web/seeded-stress-parity.mjs" \
    "$native_runner" "$clap_artifact" "$web_build/six-sines.js" "$source_dir"

cmake -E remove_directory "$package_dir"
cmake -E make_directory "$package_dir/web"
if [[ -d "$clap_artifact" ]]; then
    cmake -E copy_directory "$clap_artifact" "$package_dir/Six Sines.clap"
else
    cmake -E copy "$clap_artifact" "$package_dir/Six Sines.clap"
fi
cmake -E copy \
    "$web_build/six-sines-build.json" \
    "$package_dir"
cmake -E copy \
    "$web_build/six-sines.js" \
    "$web_build/six-sines.wasm" \
    "$web_build/six-sines-worklet.js" \
    "$web_build/six-sines-node.js" \
    "$web_build/six-sines-node.d.ts" \
    "$web_build/six-sines-build.json" \
    "$source_dir/web/README.md" \
    "$package_dir/web"

echo "Verified paired Six Sines build: $package_dir"
