# Six Sines web engine (first verified slice)

This directory contains a JUCE-free Emscripten engine, an `AudioWorkletProcessor`, and a small
CLAP-shaped browser facade. The current slice loads native `.sxsnp` files, exposes parameter
metadata, and schedules note, note-expression, parameter-value, and per-note Macro Level
modulation events by absolute audio frame.

## Build and verify

```sh
emcmake cmake -S . -B build-web -G Ninja \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo -DSIX_SINES_WEB_ENGINE_ONLY=ON
cmake --build build-web --target six-sines-check-web
```

The aggregate target runs both the addressed-note oracle and a corpus check which loads and
renders every factory `.sxsnp` through Wasm in 128-frame calls. The individual targets are
`six-sines-check-web-direct` and `six-sines-check-web-presets`.

Serve `build-web` over localhost and open `browser-smoke.html` in Chromium. A passing page has
`data-status="pass"` and reports zero late, overflowed, out-of-order, and memory-growth events.
The browser test intentionally uses a real `OfflineAudioContext` and `AudioWorkletNode`; a Node
Web Audio implementation is useful for a shorter inner loop but does not replace this gate.
`browser-realtime-smoke.html` is the separate operational gate: it runs an ordinary
`AudioContext` for 1.2 seconds and requires continuous frame advancement plus clean diagnostics.

The self-verification order is:

1. focused native engine tests inspect exact flags, routing, smoothing, voice reuse, and state;
2. the dynamic CLAP test loads the actual bundle and renders two independently addressed notes;
3. the direct-Wasm test runs the same score in 128-frame calls and the Wasm corpus loads all
   factory presets;
4. the Chromium worklet test loads the preset through the public asynchronous API and requires
   the same audio metrics.

This makes the first failing layer identify the boundary that regressed instead of treating a
silent worklet as an opaque failure.

## Use from a browser script

```js
import { ClapNoteExpression, SixSinesEventType, SixSinesNode } from "./six-sines-node.js";

const context = new AudioContext();
const synth = await SixSinesNode.create(context, {
  wasmUrl: "./six-sines.wasm",
  workletUrl: "./six-sines-worklet.js",
  presetUrl: "./my-daw-preset.sxsnp",
});
synth.connect(context.destination);

const start = Math.round((context.currentTime + 0.1) * context.sampleRate);
await synth.schedule([
  { type: SixSinesEventType.noteOn, frame: start, noteId: 101, key: 60, value: 0.8 },
  { type: SixSinesEventType.noteExpression, frame: start, noteId: 101, key: 60,
    expressionId: ClapNoteExpression.pan, value: 0.25 },
  { type: SixSinesEventType.paramMod, frame: start + 2400, noteId: 101, key: 60,
    paramId: 40000, value: 0.7 },
  { type: SixSinesEventType.noteOff, frame: start + 24000, noteId: 101, key: 60, value: 0 },
]);
```

Create the preset with Six Sines' own **Save User Preset** command in the DAW. Pass the resulting
`.sxsnp` file or its bytes to `presetUrl`, `presetBytes`, or `loadPreset()`. Schedule ahead of the
audio clock; events that arrive late are clamped to the next renderable frame and counted in
`await synth.stats()`.

Only the six Macro Level IDs are currently accepted as meaningful per-note parameter modulation:
`40000`, `40250`, `40500`, `40750`, `41000`, and `41250`. Other note expressions retain their
existing CLAP semantics; arbitrary per-note modulation of all synth parameters remains deferred.
