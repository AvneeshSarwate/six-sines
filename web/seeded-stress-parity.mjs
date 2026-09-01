#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const nativeRunner = process.argv[2];
const clapBundle = process.argv[3];
const wasmModule = process.argv[4];
const sourceRoot = resolve(process.argv[5] ?? ".");
if (!nativeRunner || !clapBundle || !wasmModule) {
  throw new Error("usage: node seeded-stress-parity.mjs NATIVE_RUNNER CLAP_BUNDLE WASM_JS [SOURCE_ROOT]");
}

const EVENT_SIZE = 40;
const TOTAL_FRAMES = 24_576;
const EVENT = { noteOn: 1, noteOff: 2, noteExpression: 3, paramValue: 4, paramMod: 5 };
const NOTE_EXPRESSION = { pan: 1, tuning: 2, pressure: 6 };

function makeEvent(frame, type, fields = {}) {
  return {
    frame, type, noteId: fields.noteId ?? -1, port: fields.port ?? 0,
    channel: fields.channel ?? 0, key: fields.key ?? -1,
    paramId: fields.paramId ?? 0, expressionId: fields.expressionId ?? 0,
    value: fields.value ?? 0, order: fields.order ?? 0,
  };
}

function generateScore() {
  let state = 0x5eed1234;
  let order = 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const events = [];
  const value = (paramId, amount) =>
    events.push(makeEvent(0, EVENT.paramValue, { paramId, value: amount, order: order++ }));
  value(500, 0.25);
  value(506, 1.0);
  value(522, 0.0);
  value(526, 8.0);
  value(529, 0.0);
  value(532, 0.0);
  value(620, 410.0);
  value(621, 1.0);
  value(650, 10.0);

  for (let index = 0; index < 160; ++index) {
    const frame = 512 + index * 128;
    const noteId = 1_000 + index;
    const key = 36 + random() % 49;
    const velocity = 0.35 + (random() % 6000) / 10_000;
    const pan = (random() % 10_001) / 10_000;
    const tuning = ((random() % 2001) - 1000) / 1000;
    const pressure = (random() % 10_001) / 10_000;
    events.push(makeEvent(frame, EVENT.noteOn,
      { noteId, key, value: velocity, order: order++ }));
    events.push(makeEvent(frame, EVENT.noteExpression,
      { noteId, key, expressionId: NOTE_EXPRESSION.pan, value: pan, order: order++ }));
    events.push(makeEvent(frame, EVENT.noteExpression,
      { noteId, key, expressionId: NOTE_EXPRESSION.tuning, value: tuning, order: order++ }));
    events.push(makeEvent(frame + 32, EVENT.noteExpression,
      { noteId, key, expressionId: NOTE_EXPRESSION.pressure, value: pressure, order: order++ }));
    events.push(makeEvent(frame + 64, EVENT.paramMod,
      { noteId, key, paramId: 40_000, value: ((random() % 2001) - 1000) / 1000,
        order: order++ }));
    if (index % 11 === 0) {
      events.push(makeEvent(frame + 72, EVENT.paramMod,
        { noteId: 90_000 + index, key, paramId: 40_000, value: 0.75, order: order++ }));
    }
    const offFrame = frame + 256 + (random() % 6) * 128;
    if (offFrame < TOTAL_FRAMES) {
      events.push(makeEvent(offFrame, EVENT.noteOff,
        { noteId, key, value: 0, order: order++ }));
    }
  }
  return events.sort((a, b) => a.frame - b.frame || a.order - b.order);
}

function encodeScore(events) {
  const bytes = new Uint8Array(events.length * EVENT_SIZE);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < events.length; ++index) {
    const event = events[index];
    const at = index * EVENT_SIZE;
    view.setUint32(at, event.frame, true);
    view.setUint32(at + 4, event.type, true);
    view.setInt32(at + 8, event.noteId, true);
    view.setInt16(at + 12, event.port, true);
    view.setInt16(at + 14, event.channel, true);
    view.setInt16(at + 16, event.key, true);
    view.setInt16(at + 18, 0, true);
    view.setUint32(at + 20, event.paramId, true);
    view.setInt32(at + 24, event.expressionId, true);
    view.setFloat64(at + 32, event.value, true);
  }
  return bytes;
}

const score = generateScore();
const scoreBytes = encodeScore(score);
const temporary = await mkdtemp(join(tmpdir(), "six-sines-stress-"));
const scorePath = join(temporary, "score.sxev");
const pcmPath = join(temporary, "native.f32");
const presetPath = resolve(sourceRoot, "resources/factory_patches/Templates/INIT Sine.sxsnp");

try {
  await writeFile(scorePath, scoreBytes);
  const native = spawnSync(nativeRunner, [clapBundle, presetPath, pcmPath, scorePath],
    { encoding: "utf8" });
  assert.equal(native.status, 0, `${native.stdout}\n${native.stderr}`);

  const { default: createModule } = await import(pathToFileURL(wasmModule));
  const wasm = await createModule();
  const handle = wasm._sx_create(48_000);
  assert.notEqual(handle, 0);
  const allocations = [];
  const allocate = (bytes) => {
    const pointer = wasm._malloc(bytes);
    assert.notEqual(pointer, 0);
    allocations.push(pointer);
    return pointer;
  };
  try {
    const preset = await readFile(presetPath);
    const presetPointer = allocate(preset.byteLength);
    wasm.HEAPU8.set(preset, presetPointer);
    assert.equal(wasm._sx_load_preset_utf8(handle, presetPointer, preset.byteLength), 1);

    const eventPointer = allocate(scoreBytes.byteLength);
    const leftPointer = allocate(TOTAL_FRAMES * 4);
    const rightPointer = allocate(TOTAL_FRAMES * 4);
    const eventView = new DataView(wasm.HEAPU8.buffer, eventPointer, scoreBytes.byteLength);
    const writeEvent = (event, index, localFrame) => {
      const at = index * EVENT_SIZE;
      eventView.setUint32(at, localFrame, true);
      eventView.setUint32(at + 4, event.type, true);
      eventView.setInt32(at + 8, event.noteId, true);
      eventView.setInt16(at + 12, event.port, true);
      eventView.setInt16(at + 14, event.channel, true);
      eventView.setInt16(at + 16, event.key, true);
      eventView.setInt16(at + 18, 0, true);
      eventView.setUint32(at + 20, event.paramId, true);
      eventView.setInt32(at + 24, event.expressionId, true);
      eventView.setFloat64(at + 32, event.value, true);
    };
    let nextEvent = 0;
    for (let renderFrame = 0; renderFrame < TOTAL_FRAMES; renderFrame += 128) {
      let eventCount = 0;
      while (nextEvent < score.length && score[nextEvent].frame < renderFrame + 128) {
        writeEvent(score[nextEvent], eventCount, score[nextEvent].frame - renderFrame);
        ++nextEvent;
        ++eventCount;
      }
      assert.equal(wasm._sx_process(handle, 128, 0, 0,
        leftPointer + renderFrame * 4, rightPointer + renderFrame * 4,
        eventPointer, eventCount), 1);
    }
    assert.equal(nextEvent, score.length);
    const nativeBytes = await readFile(pcmPath);
    const nativePcm = new Float32Array(nativeBytes.buffer, nativeBytes.byteOffset,
      nativeBytes.byteLength / 4);
    const left = wasm.HEAPF32.subarray(leftPointer / 4, leftPointer / 4 + TOTAL_FRAMES);
    const right = wasm.HEAPF32.subarray(rightPointer / 4, rightPointer / 4 + TOTAL_FRAMES);
    let squaredError = 0;
    let squaredReference = 0;
    let maxAbsoluteError = 0;
    let peak = 0;
    for (let frame = 0; frame < TOTAL_FRAMES; ++frame) {
      for (let channel = 0; channel < 2; ++channel) {
        const actual = channel ? right[frame] : left[frame];
        const expected = nativePcm[channel * TOTAL_FRAMES + frame];
        assert.ok(Number.isFinite(actual));
        const error = actual - expected;
        squaredError += error * error;
        squaredReference += expected * expected;
        maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(error));
        peak = Math.max(peak, Math.abs(actual));
      }
    }
    const normalizedRmse = Math.sqrt(squaredError / squaredReference);
    assert.ok(peak > 1e-5, "stress score rendered silence");
    assert.ok(normalizedRmse < 0.02, `native/Wasm stress drift: ${normalizedRmse}`);
    console.log(JSON.stringify({
      test: "seeded-native-clap-wasm-voice-stress",
      status: "pass",
      seed: "0x5eed1234",
      event_count: score.length,
      note_count: 160,
      configured_polyphony: 8,
      peak,
      normalized_rmse: normalizedRmse,
      max_absolute_error: maxAbsoluteError,
    }, null, 2));
  } finally {
    for (const pointer of allocations.reverse()) wasm._free(pointer);
    wasm._sx_destroy(handle);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
