#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];
const presetRoot = process.argv[3];
if (!modulePath || !presetRoot) {
  throw new Error("usage: node web/preset-corpus-smoke.mjs /path/to/six-sines.js factory-patch-dir");
}

async function presetFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await presetFiles(resolved));
    else if (entry.isFile() && entry.name.endsWith(".sxsnp")) result.push(resolved);
  }
  return result;
}

const files = (await presetFiles(presetRoot)).sort();
assert.ok(files.length > 0, `no .sxsnp files below ${presetRoot}`);
const presets = await Promise.all(files.map(async (file) => ({ file, bytes: await readFile(file) })));
const maximumPresetSize = Math.max(...presets.map(({ bytes }) => bytes.byteLength));

const { default: createModule } = await import(pathToFileURL(modulePath));
const wasm = await createModule();
const eventSize = wasm._sx_event_sizeof();
assert.equal(eventSize, 40, "unexpected sx_event ABI layout");

const renderFrames = 4096;
const renderQuantum = 128;
const presetPointer = wasm._malloc(maximumPresetSize);
const eventPointer = wasm._malloc(eventSize);
const leftPointer = wasm._malloc(renderFrames * Float32Array.BYTES_PER_ELEMENT);
const rightPointer = wasm._malloc(renderFrames * Float32Array.BYTES_PER_ELEMENT);
assert.ok(presetPointer && eventPointer && leftPointer && rightPointer, "Wasm allocation failed");

function writeNoteOn(noteId, key) {
  const view = new DataView(wasm.HEAPU8.buffer, eventPointer, eventSize);
  view.setUint32(0, 0, true);
  view.setUint32(4, 1, true);
  view.setInt32(8, noteId, true);
  view.setInt16(12, 0, true);
  view.setInt16(14, 0, true);
  view.setInt16(16, key, true);
  view.setInt16(18, 0, true);
  view.setUint32(20, 0, true);
  view.setInt32(24, 0, true);
  view.setFloat64(32, 0.8, true);
}

let nonSilentPresetCount = 0;
let aggregatePeak = 0;
try {
  for (let index = 0; index < presets.length; ++index) {
    const { file, bytes } = presets[index];
    const handle = wasm._sx_create(48_000);
    assert.notEqual(handle, 0, `sx_create failed for ${file}`);
    try {
      wasm.HEAPU8.set(bytes, presetPointer);
      assert.equal(wasm._sx_load_preset_utf8(handle, presetPointer, bytes.byteLength), 1,
        `preset load failed: ${file}`);
      assert.equal(wasm._sx_get_param_count(handle), 2554, `parameter count changed: ${file}`);
      writeNoteOn(10_000 + index, 48 + index % 24);
      for (let frame = 0; frame < renderFrames; frame += renderQuantum) {
        assert.equal(wasm._sx_process(handle, renderQuantum, 0, 0,
          leftPointer + frame * Float32Array.BYTES_PER_ELEMENT,
          rightPointer + frame * Float32Array.BYTES_PER_ELEMENT,
          eventPointer, frame === 0 ? 1 : 0), 1, `render failed at ${frame}: ${file}`);
      }

      const heap = wasm.HEAPF32;
      const leftAt = leftPointer / Float32Array.BYTES_PER_ELEMENT;
      const rightAt = rightPointer / Float32Array.BYTES_PER_ELEMENT;
      let peak = 0;
      for (let frame = 0; frame < renderFrames; ++frame) {
        const left = heap[leftAt + frame];
        const right = heap[rightAt + frame];
        assert.ok(Number.isFinite(left) && Number.isFinite(right),
          `non-finite output at frame ${frame}: ${file}`);
        peak = Math.max(peak, Math.abs(left), Math.abs(right));
      }
      if (peak > 1e-7) ++nonSilentPresetCount;
      aggregatePeak = Math.max(aggregatePeak, peak);
    } finally {
      wasm._sx_destroy(handle);
    }
  }

  console.log(JSON.stringify({
    test: "factory-preset-direct-wasm",
    status: "pass",
    preset_count: presets.length,
    rendered_frames_per_preset: renderFrames,
    render_quantum: renderQuantum,
    finite_preset_count: presets.length,
    non_silent_preset_count: nonSilentPresetCount,
    aggregate_peak: aggregatePeak,
  }, null, 2));
} finally {
  wasm._free(rightPointer);
  wasm._free(leftPointer);
  wasm._free(eventPointer);
  wasm._free(presetPointer);
}
