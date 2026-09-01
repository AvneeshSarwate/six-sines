# Six Sines browser AudioWorklet engine

This port runs the Six Sines DSP and preset loader in a real-time `AudioWorkletProcessor`, with
no JUCE or plugin UI in the browser. It loads the same `.sxsnp` state files as the native CLAP
build and exposes CLAP-shaped note identities, note expressions, parameter values, and per-note
Macro Level modulation.

## Paired native and browser build

From the repository root, run:

```sh
./scripts/build-browser-port.sh
```

This produces and verifies one matched pair under `build/browser-port/package`:

- `Six Sines.clap` is the native plugin to install or point your DAW at;
- `web/` contains `six-sines.js`, `six-sines.wasm`, the AudioWorklet, and JavaScript facade;
- `six-sines-build.json` records the Git source ID shared by the pair.

The script builds from a single source tree, runs the native and Wasm test layers, and only then
assembles the package. A dirty source tree is deliberately identified with a `-dirty` suffix.
The browser reports its compiled identity as `synth.readyInfo.buildId`; the real-browser
hardening test requires it to equal the manifest's `sourceId`. The native CLAP descriptor and
About screen include the same source hash.

For the intended preset workflow:

1. Install the packaged native CLAP and use that build in your DAW.
2. Design the sound and use Six Sines' **Save User Preset** command to write an `.sxsnp` file.
3. Serve your application, the packaged `web/` files, and the preset over HTTP(S).
4. Pass the preset URL or bytes to `SixSinesNode.create()`, or replace it later with
   `loadPreset()`.

Using the paired CLAP for sound design minimizes source drift. Preset loading preserves the
authored patch; the runtime does not rewrite it into a browser-specific format.

## Real-time API

```js
import { ClapNoteExpression, SixSinesEventType, SixSinesNode } from "./six-sines-node.js";

const context = new AudioContext({ latencyHint: "interactive" });
const synth = await SixSinesNode.create(context, {
  wasmUrl: "./six-sines.wasm",
  workletUrl: "./six-sines-worklet.js",
  presetUrl: "./my-daw-preset.sxsnp",
});
synth.connect(context.destination);
await context.resume();

await synth.send([
  { type: SixSinesEventType.noteOn, noteId: 101, key: 60, value: 0.8 },
  { type: SixSinesEventType.noteExpression, noteId: 101, key: 60,
    expressionId: ClapNoteExpression.pan, value: 0.25 },
]);

setTimeout(() => synth.paramMod({
  noteId: 101, key: 60, paramId: 40000, amount: 0.7,
}), 50);
setTimeout(() => synth.noteOff({ noteId: 101, key: 60 }), 500);
```

`send()` preserves the order of a batch and delivers it on the next AudioWorklet render quantum.
The untimed `noteOn()`, `noteOff()`, `noteExpression()`, `paramValue()`, `paramMod()`, and
`allNotesOff()` helpers do the same. This is the normal API for a `setTimeout`-driven performance
scheduler: JavaScript timer and message-port jitter still applies, but callers do not manage
audio frame numbers.

`schedule()` is an advanced verification API. Every scheduled event must contain an absolute
audio `frame` or `time`, making native/Wasm test scores deterministic. Runtime code does not need
it. Late scheduled events are clamped and counted in `await synth.stats()`.

Use the device's normal rate with `new AudioContext()` unless an application has a reason to
request one. The worklet is initialized with the actual context sample rate. The automated
coverage renders at 44.1 and 48 kHz in real Chromium and renders the full preset corpus at 48 and
96 kHz offline.

The currently per-note-modulatable parameters are the six Macro Levels: `40000`, `40250`,
`40500`, `40750`, `41000`, and `41250`. Per-note `paramMod()` requires a non-negative CLAP
`noteId`; an unknown or retired note ID is ignored. CLAP note expressions retain their existing
addressing semantics.

## Self-verification layers

Verification is layered as follows. The paired build script runs gates 1–4 before packaging;
agent or release automation runs gate 5 in Chromium against that output.

1. Native unit tests cover parameter flags, smoothing, note identity, voice reuse/stealing,
   state invariants, and process calls that do not align to the synth's internal block size.
2. A minimal dynamic host loads the built `.clap`, checks that exactly the six Macro Levels have
   `CLAP_PARAM_IS_MODULATABLE_PER_NOTE_ID`, and proves modulation changes only the addressed
   same-key voice while unknown note IDs do nothing.
3. Native CLAP and Wasm load the same real presets and render the same binary event score; PCM is
   compared with a normalized-error bound. A separate seeded stress score covers 160 note IDs,
   per-note expression/modulation, polyphony pressure, voice stealing, and unknown IDs.
4. Every factory preset renders finite, non-silent Wasm audio at 48 and 96 kHz.
5. `browser-realtime-hardening.html` runs the public immediate API in a real ordinary
   `AudioContext`, checks live audio and event accounting, replaces a preset, suspends/resumes,
   disconnects/reconnects, drains queues, and disposes cleanly. Run it from the web build with
   optional `?sampleRate=44100&phaseMs=2000` query parameters.

The deterministic offline tests are the fast parity oracle. A Node Web Audio implementation can
help with API experiments, but it is not the final gate: real Chromium is required to exercise
the browser's AudioWorklet thread, WebAssembly instantiation, message delivery, context lifecycle,
and audio-device rendering behavior.

For a web-only development build, use:

```sh
emcmake cmake -S . -B build-web -G Ninja \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo -DSIX_SINES_WEB_ENGINE_ONLY=ON
cmake --build build-web --target six-sines-check-web
```
