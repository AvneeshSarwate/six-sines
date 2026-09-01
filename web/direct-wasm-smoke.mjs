#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];
const presetPath = process.argv[3];
const renderQuantum = Number(process.argv[4] ?? 24_576);
const nativePcmPath = process.argv[5];
if (!modulePath) {
  throw new Error("usage: node web/direct-wasm-smoke.mjs /path/to/six-sines.js [preset.sxsnp]");
}

const { default: createModule } = await import(pathToFileURL(modulePath));
const wasm = await createModule();
const handle = wasm._sx_create(48_000);
assert.notEqual(handle, 0, "sx_create failed");

const EVENT = {
  noteOn: 1,
  noteExpression: 3,
  paramValue: 4,
  paramMod: 5,
};
const CLAP_PARAM_IS_MODULATABLE_PER_NOTE_ID = 1 << 11;
const NOTE_EXPRESSION_PAN = 1;
const totalFrames = 24_576;

function relativeDifference(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-12);
}

function rms(signal, begin, end) {
  let sum = 0;
  for (let i = begin; i < end; ++i) sum += signal[i] * signal[i];
  return Math.sqrt(sum / (end - begin));
}

function makeEvent(frame, type, {
  noteId = -1,
  port = 0,
  channel = 0,
  key = -1,
  paramId = 0,
  expressionId = 0,
  value = 0,
} = {}) {
  return { frame, type, noteId, port, channel, key, paramId, expressionId, value };
}

const allocations = [];
function allocate(bytes) {
  const pointer = wasm._malloc(bytes);
  assert.notEqual(pointer, 0, `malloc(${bytes}) failed`);
  allocations.push(pointer);
  return pointer;
}

try {
  if (presetPath) {
    const preset = await readFile(presetPath);
    const presetPointer = allocate(preset.byteLength);
    wasm.HEAPU8.set(preset, presetPointer);
    assert.equal(wasm._sx_load_preset_utf8(handle, presetPointer, preset.byteLength), 1,
      "preset load failed");
  }

  const expectedPerNoteIds = new Set([40_000, 40_250, 40_500, 40_750, 41_000, 41_250]);
  const discoveredPerNoteIds = new Set();
  const paramInfoSize = wasm._sx_param_info_sizeof();
  assert.ok(paramInfoSize >= 288);
  const paramInfoPointer = allocate(paramInfoSize);
  const paramCount = wasm._sx_get_param_count(handle);
  assert.ok(paramCount > 2_500);
  for (let index = 0; index < paramCount; ++index) {
    assert.equal(wasm._sx_get_param_info(handle, index, paramInfoPointer), 1);
    const view = new DataView(wasm.HEAPU8.buffer, paramInfoPointer, paramInfoSize);
    const id = view.getUint32(0, true);
    const flags = view.getUint32(4, true);
    if (flags & CLAP_PARAM_IS_MODULATABLE_PER_NOTE_ID) discoveredPerNoteIds.add(id);
  }
  assert.deepEqual(discoveredPerNoteIds, expectedPerNoteIds);

  const events = [
    makeEvent(0, EVENT.paramValue, { paramId: 500, value: 0.5 }),
    // The focused modulation oracle needs a stationary sustain level. A native/Wasm preset
    // comparison must not alter this sound-design parameter, so it uses the saved value.
    !nativePcmPath && makeEvent(0, EVENT.paramValue, { paramId: 506, value: 1 }),
    makeEvent(0, EVENT.paramValue, { paramId: 522, value: 0 }),
    makeEvent(0, EVENT.paramValue, { paramId: 529, value: 0 }),
    makeEvent(0, EVENT.paramValue, { paramId: 532, value: 0 }),
    makeEvent(0, EVENT.paramValue, { paramId: 620, value: 410 }),
    makeEvent(0, EVENT.paramValue, { paramId: 621, value: 1 }),
    makeEvent(0, EVENT.paramValue, { paramId: 650, value: 10 }),
    makeEvent(512, EVENT.noteOn, { noteId: 101, key: 60, value: 0.8 }),
    makeEvent(512, EVENT.noteExpression,
      { noteId: 101, key: 60, expressionId: NOTE_EXPRESSION_PAN, value: 0 }),
    makeEvent(512, EVENT.noteOn, { noteId: 102, key: 60, value: 0.8 }),
    makeEvent(512, EVENT.noteExpression,
      { noteId: 102, key: 60, expressionId: NOTE_EXPRESSION_PAN, value: 1 }),
    makeEvent(8_192, EVENT.paramMod, { noteId: 101, key: 60, paramId: 40_000, value: 0.7 }),
    makeEvent(13_312, EVENT.paramMod, { noteId: 102, key: 60, paramId: 40_000, value: -0.4 }),
    makeEvent(18_432, EVENT.paramMod, { noteId: 9_999, key: 60, paramId: 40_000, value: 0.9 }),
  ].filter(Boolean).sort((a, b) => a.frame - b.frame);

  const eventSize = wasm._sx_event_sizeof();
  assert.equal(eventSize, 40, "unexpected sx_event ABI layout");
  const eventPointer = allocate(eventSize * events.length);
  const eventView = new DataView(wasm.HEAPU8.buffer, eventPointer, eventSize * events.length);
  function writeEvent(event, index, frame = event.frame) {
    const at = index * eventSize;
    eventView.setUint32(at + 0, frame, true);
    eventView.setUint32(at + 4, event.type, true);
    eventView.setInt32(at + 8, event.noteId, true);
    eventView.setInt16(at + 12, event.port, true);
    eventView.setInt16(at + 14, event.channel, true);
    eventView.setInt16(at + 16, event.key, true);
    eventView.setInt16(at + 18, 0, true);
    eventView.setUint32(at + 20, event.paramId, true);
    eventView.setInt32(at + 24, event.expressionId, true);
    eventView.setFloat64(at + 32, event.value, true);
  }

  const leftPointer = allocate(totalFrames * Float32Array.BYTES_PER_ELEMENT);
  const rightPointer = allocate(totalFrames * Float32Array.BYTES_PER_ELEMENT);
  let nextEvent = 0;
  for (let renderFrame = 0; renderFrame < totalFrames; renderFrame += renderQuantum) {
    const frameCount = Math.min(renderQuantum, totalFrames - renderFrame);
    let eventCount = 0;
    while (nextEvent < events.length && events[nextEvent].frame < renderFrame + frameCount) {
      writeEvent(events[nextEvent], eventCount++, events[nextEvent].frame - renderFrame);
      ++nextEvent;
    }
    assert.equal(wasm._sx_process(handle, frameCount, 0, 0,
      leftPointer + renderFrame * Float32Array.BYTES_PER_ELEMENT,
      rightPointer + renderFrame * Float32Array.BYTES_PER_ELEMENT,
      eventPointer, eventCount), 1, `sx_process failed at frame ${renderFrame}`);
  }
  const left = new Float32Array(wasm.HEAPF32.subarray(leftPointer / 4, leftPointer / 4 + totalFrames));
  const right = new Float32Array(wasm.HEAPF32.subarray(rightPointer / 4, rightPointer / 4 + totalFrames));

  const controlLeft = rms(left, 4_096, 7_168);
  const controlRight = rms(right, 4_096, 7_168);
  const modALeft = rms(left, 9_216, 12_288);
  const modARight = rms(right, 9_216, 12_288);
  const dualLeft = rms(left, 14_336, 17_408);
  const dualRight = rms(right, 14_336, 17_408);
  const unknownLeft = rms(left, 19_456, 22_528);
  const unknownRight = rms(right, 19_456, 22_528);
  const report = {
    test: "macro-per-note-direct-wasm",
    status: "pass",
    param_count: paramCount,
    per_note_parameter_count: discoveredPerNoteIds.size,
    render_quantum: renderQuantum,
    mod_a_addressed_relative_change: relativeDifference(controlLeft, modALeft),
    mod_a_other_relative_change: relativeDifference(controlRight, modARight),
    mod_b_addressed_relative_change: relativeDifference(modARight, dualRight),
    mod_b_other_relative_change: relativeDifference(modALeft, dualLeft),
    unknown_left_relative_change: relativeDifference(dualLeft, unknownLeft),
    unknown_right_relative_change: relativeDifference(dualRight, unknownRight),
  };

  if (nativePcmPath) {
    const nativeBytes = await readFile(nativePcmPath);
    assert.equal(nativeBytes.byteLength, totalFrames * 2 * Float32Array.BYTES_PER_ELEMENT,
      "unexpected native PCM reference size");
    const native = new Float32Array(nativeBytes.buffer, nativeBytes.byteOffset,
      nativeBytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
    let squaredError = 0;
    let squaredReference = 0;
    let maxAbsoluteError = 0;
    for (let frame = 0; frame < totalFrames; ++frame) {
      for (let channel = 0; channel < 2; ++channel) {
        const actual = channel === 0 ? left[frame] : right[frame];
        const expected = native[channel * totalFrames + frame];
        const error = actual - expected;
        squaredError += error * error;
        squaredReference += expected * expected;
        maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(error));
      }
    }
    report.native_wasm_normalized_rmse = Math.sqrt(squaredError / squaredReference);
    report.native_wasm_max_absolute_error = maxAbsoluteError;
    assert.ok(report.native_wasm_normalized_rmse < 0.02,
      `native/Wasm PCM drift: ${JSON.stringify(report)}`);
  }

  console.log(JSON.stringify(report, null, 2));
  assert.ok(controlLeft > 1e-5 && controlRight > 1e-5);
  if (!nativePcmPath) {
    assert.ok(report.mod_a_addressed_relative_change > 0.20);
    assert.ok(report.mod_a_other_relative_change < 0.05);
    assert.ok(report.mod_b_addressed_relative_change > 0.20);
    assert.ok(report.mod_b_other_relative_change < 0.05);
    assert.ok(report.unknown_left_relative_change < 0.05);
    assert.ok(report.unknown_right_relative_change < 0.05);
  }
} finally {
  for (const pointer of allocations.reverse()) wasm._free(pointer);
  wasm._sx_destroy(handle);
}
