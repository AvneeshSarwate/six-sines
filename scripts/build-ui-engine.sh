#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export EM_CACHE="${EM_CACHE:-$repo_dir/ignore/emscripten-cache}"
emcmake cmake -S "$repo_dir" -B "$repo_dir/ignore/browser-engine" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DSIX_SINES_WEB_ENGINE_ONLY=ON -DSIX_SINES_PAIRED_BUILD=ON
cmake --build "$repo_dir/ignore/browser-engine" --target six-sines-web --parallel 6
node "$repo_dir/browser-ui/scripts/sync-engine.mjs"
