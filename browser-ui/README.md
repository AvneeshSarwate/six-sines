# Six Sines browser parity playground

Vue 3 / Vite / TypeScript editor with the repository’s native DSP compiled to WASM in an AudioWorklet. The standalone app plays audio and accepts MIDI; the exported `SixSinesEditor` component remains usable as a preset-only editor.

## Run

Use Node 22.12+ (validated with 22.20):

```sh
cd browser-ui
npm ci
npm run engine:build # requires Emscripten (emcmake), CMake, and Ninja
npm run dev
```

`npm run build` type-checks and creates the standalone site in `dist/`; `npm run preview` serves it. Relative asset URLs support hosting below a URL prefix.

## Play and A/B with the plugin

1. Click **Start audio**. Hold the on-screen keys (or focus one and hold Space) to audition.
2. Click **Enable MIDI**, allow access, and select your controller or virtual MIDI port. Choose All channels or a single channel. Sustain, pitch bend, CCs/mod wheel, channel pressure, and poly aftertouch use the plugin’s MIDI handler.
3. Load the same `.sxsnp` in the browser and the plugin. Import accepts a native file or drag/drop; Export saves all editor values for loading in the plugin. Edits and undo/redo update the playing engine without restarting held notes. Full preset replacement starts a new performance.
4. Feed the same controller to Ableton and the selected browser input. Toggle **Mute browser** and the Ableton track mute to compare. Monitor defaults to unity (0 dB), is separate from the patch, and is not exported. **Panic** clears notes and sustain.

MIDI requires a supporting browser and a secure context (localhost or HTTPS); see [Web MIDI access](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMIDIAccess). No MIDI outputs or SysEx are requested. Device changes/disconnection release notes. Program changes do not select presets. There is no microphone/audio-input connection in this playground, so patches using the Audio In oscillator need a separate input integration. Host tempo transport and MPE configuration are not connected.

The engine is built locally from this branch, not downloaded from a different release. Re-run `npm run engine:build` after DSP changes. Generated assets go to ignored `public/engine/` and are included in `dist/`. `npm run dev` / `build` copy those assets automatically; `SIX_SINES_ENGINE_DIR` can point to another compatible WASM build. The copied JS wrapper/worklet always come from this checkout.

## Editing

- Select an operator, matrix cell, mixer knob, or macro to open its inspector.
- Drag knobs vertically; Shift gives fine movement. Double-click to enter displayed units; Alt-click resets. Operator ratios accept fractions such as `3/2`.
- Other Modulation assigns sources, destinations, and signed depths. Both macro amplitude and modulated sources are available. Macro assignment counts open a list of destinations.
- Envelope trigger settings expose one-shot and on-release behavior. Step reveals the active number of sequencer rows (up to 16). Oscillator extend modes reveal associated settings.
- Source controls follow the native Env/LFO pitch, Pitch, Wave, and Extended Mode groups. The gear opens grouped Play, Trigger, Bend, Unison, and Output Stage settings.
- Click the preset name for the searchable 216-preset factory library. Import accepts files or drag/drop. Export downloads a native preset. Undo/Redo handles edits. Edit name/author through the header ellipsis.

## Embed in Vue

Import from `src/index.ts` in a Vite/Vue application. It includes the stylesheet and bundled fonts.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { SixSinesEditor } from './path/to/browser-ui/src'

const editor = ref<InstanceType<typeof SixSinesEditor>>()
function onExport(bytes: Uint8Array, filename: string) {
  // Write bytes to your storage or pass them to your headless integration.
  console.log(filename, bytes.byteLength)
}
async function load(file: File) {
  editor.value?.loadPreset(new Uint8Array(await file.arrayBuffer()))
}
function getBytes() {
  return editor.value?.exportPreset()
}
</script>

<template>
  <SixSinesEditor
    ref="editor"
    preset-base-url="/six-sines-assets/"
    :download-on-export="false"
    @export="onExport"
  />
</template>
```

`loadPreset(string | Uint8Array)` validates XML and throws on invalid input. `exportPreset()` returns a Uint8Array. The export event fires when the user presses Export. `downloadOnExport` defaults to true; disable it when the parent handles persistence. Serve `public/presets` at `/six-sines-assets/presets` for this example. `presetBaseUrl` must end in `/` and changes only the factory-library URL.

Below about 1000px wide the instrument scrolls horizontally. The stylesheet includes page-level defaults, so review its global selectors when embedding into an existing design system.

## Native data

`src/data/schema.json` is generated from this branch's C++ metadata: 2,554 parameters across 42 nodes, with IDs, ranges, defaults, choices, modulation sources and targets. `init.sxsnp` comes from the same native harness. No JUCE code is shipped to the browser.

The loader mirrors native version 3–12 migrations. Versions 1–2 require re-saving in the native plugin. Unknown parameters and extra XML elements survive export. Future version numbers are preserved, but future engine compatibility is not guaranteed. Exported values use native storage units.

To refresh the data, use the [reference harness](../doc/ui-reference-harness.md) to issue `{"op":"schema"}` `{"op":"waveforms"}`, and, on an untouched Init patch, `{"op":"export","name":"init"}`. Then run:

```sh
node scripts/sync-native-data.mjs /absolute/path/to/reference-output
```

This also copies the repository factory presets and rebuilds their search index.

## Validation

```sh
npm test
npm run build
```

Tests cover all 216 factory round trips, XML extension preservation, malformed input, macro assignment/undo, and common inspector fields. The C++ comparison is opt-in: issue `{"op":"normalize-presets","path":"/absolute/path/to/browser-ui/public/presets"}` to the native harness, then run:

```sh
NATIVE_PRESETS=../target/push2-native/browser-parity/normalized npm test
```

September 10, 2026: the original six preset tests passed, including all 216 presets compared with C++ migrations. A preset exported through Chromium with Op 5 → Op 6 enabled, Macro 1 Amplitude → Level, depth 0.5 was loaded/exported by C++; all 2,554 values matched within 1e-6. Browser checks exercised assignment, export, step editing, release triggers, resonant extend controls, and factory search/load. Local evidence is in git-ignored `output/playwright/`.

This establishes preset and selected interaction parity, not exhaustive UI parity. Native popup styling, all contextual menu restrictions, tempo-dependent formatting, drag response curves, light-theme polish, and every context action have not been reproduced exactly. Oscillator previews use sampled native waveforms; phase-map and resonant-sweep previews follow the native formulas. Noise is a stable illustration, and the native smoothed step-curve overlay is not yet reproduced. Audio meters and waveform monitoring require engine integration. Automated pixel-difference thresholds against JUCE have not been established.

## Attribution

Schema, Init, presets, and layout derive from Six Sines by Paul Walker and contributors; see [the repository license](../LICENSE.md). Manrope and Anonymous Pro retain their SIL Open Font License notices in `src/assets/fonts/`. Dependencies retain their respective licenses.

The structural parity follow-up adds nine rendered-component regression tests covering Extend Mode visibility, Noise N/LFSR gating, pitch/Audio In restrictions, step counts, trigger choices, mixer/tuning/pan depths, grouped settings, and RM rescaling. See [the parity audit](./PARITY.md). Host-only MPE and automation smoothing settings are intentionally outside this preset-file component.

The editor also emits `parameters` (arrays of `{id, value}` deltas, including undo/redo) and `preset-load` (canonical preset bytes on import/library/New/programmatic load). The playground uses these events to drive the engine. Set `playable` only to change the component’s help/badge for an audio-enabled host.
