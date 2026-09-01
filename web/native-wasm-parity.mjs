#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const nativeRunner = process.argv[2];
const clapBundle = process.argv[3];
const wasmModule = process.argv[4];
const sourceRoot = resolve(process.argv[5] ?? ".");
if (!nativeRunner || !clapBundle || !wasmModule) {
  throw new Error("usage: node native-wasm-parity.mjs NATIVE_RUNNER CLAP_BUNDLE WASM_JS [SOURCE_ROOT] [PRESET ...]");
}

const requestedPresets = process.argv.slice(6);
const presets = (requestedPresets.length ? requestedPresets : [
  "resources/factory_patches/Templates/INIT Sine.sxsnp",
  "resources/factory_patches/Bass/Warrior Macros.sxsnp",
  "resources/factory_patches/Keys/Poly-LFOs.sxsnp",
]).map((preset) => resolve(sourceRoot, preset));
const directRunner = resolve(fileURLToPath(new URL("./direct-wasm-smoke.mjs", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "six-sines-parity-"));

function run(command, args, description) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${description} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

try {
  const reports = [];
  for (let index = 0; index < presets.length; ++index) {
    const preset = presets[index];
    const pcm = join(temporary, `${index}.f32`);
    run(nativeRunner, [clapBundle, preset, pcm], `native CLAP render for ${preset}`);
    const wasm = run(process.execPath,
      [directRunner, wasmModule, preset, "128", pcm], `Wasm render for ${preset}`);
    const report = JSON.parse(wasm.stdout);
    assert.ok(report.native_wasm_normalized_rmse < 0.02);
    reports.push({
      preset: basename(preset),
      normalized_rmse: report.native_wasm_normalized_rmse,
      max_absolute_error: report.native_wasm_max_absolute_error,
    });
  }
  console.log(JSON.stringify({
    test: "same-build-native-clap-wasm-preset-parity",
    status: "pass",
    preset_count: reports.length,
    reports,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
