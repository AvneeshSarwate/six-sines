# Structural UI parity audit

Scope: control placement, labels, visibility, interaction, and enablement against the native UI in this branch. Colors, borders, gradients, and exact pixel placement are not targets.

## Fixed

| Area | Previous browser behavior | Updated behavior / native reference |
| --- | --- | --- |
| Source layout | Wave/extend controls above the envelope; generic “More source settings” dump duplicated fields | Envelope/LFO first, then Env/LFO coarse/fine pitch depths, Pitch, Wave, and Extended Mode. `src/ui/source-sub-panel.cpp:899` |
| Phase Map | M and N exposed | Shape switch, mapping/wave previews, M / Env→M / LFO→M only. `source-sub-panel.cpp:1174` |
| Resonant Sweep | Wrong grouping and unnecessary N controls | Window, Depth, waveform preview, M controls only. `source-sub-panel.cpp:1080` |
| Noise | N and LFSR always usable | N visible but disabled for White/Pink; enabled for Tilt/Chip. LFSR selector only for Chip. `source-sub-panel.cpp:1220` |
| Pitch | Fine modulation and fixed-frequency controls buried in raw settings | Dedicated coarse/fine controls; keytrack/low-frequency/octave gating; unison routing grouped under Unison. `source-sub-panel.cpp:1226` |
| Audio In | Oscillator and feedback controls editable | Only offered on Op 1; oscillator ratio/phase/modulators/extend and feedback disabled when selected. Source power remains usable, matching native. `source-panel.cpp:321`, `matrix-panel.cpp:325` |
| Source modulation targets | Extend targets always available | M enabled for the three active modes, N only for Noise; switching modes preserves stored assignments. Uses target IDs 18/19. `source-sub-panel.cpp:571` |
| LFO | Large invented waveform preview and 16 vertical step bars below it | Native three-column layout: shapes, rate/options, horizontal sequencer rows. Active Step Count determines rows. Bipolar disabled for Step; Step Count/Cycle disabled for other shapes. `lfo-components.h:451`, `lfo-components.h:508` |
| Envelope | Invented power toggle in header; no trigger-choice gating | Tempo Sync in header. Main cannot select Voice Start/On Release; One Shot disabled for On Release; one-shot glyph shown. Runtime enum remains L/S/K/D/R for values 0–4. `dahdsr-components.h:167`, `dsp/node_support.h:39` |
| Matrix/self/macro envelope depth | Enabled in Scale mode | Disabled in Scale mode; depth applies in Add mode. `matrix-sub-panel.cpp:130`, `macro-sub-panel.cpp:243` |
| Matrix mode | Simple PM/RM/Lin/Exp select | Menu includes native RM by Signal / abs(Signal) / (1+Signal)/2 choices, disabled unless RM is active. `matrix-panel.cpp:280` |
| Mixer | LFO→Pan buried in generic settings | Level and Pan LFO depths appear together. `mixer-sub-panel.cpp:39` |
| Tuning | Coarse controls missing; modulation depth called Level | Tune, Env Depth, and LFO Depth each have Fine/Coarse controls. `finetune-sub-panel.cpp:31` |
| Main Pan | LFO depth missed by suffix matching | Dedicated Pan group with Env→ and LFO→ knobs. `mainpan-sub-panel.cpp:29` |
| Main | Velocity sensitivity buried in raw settings | Visible Mod group with Vel Sens and LFO→. `main-sub-panel.cpp:32` |
| Macro | Modulators active with macro power off | Modulators/depths/slots disabled with power off; name and amplitude remain editable. Name and Used By appear below depth controls. `macro-sub-panel.cpp:204` |
| Settings | Every Main parameter, including unused and envelope/LFO internals | Explicit Play, Default Envelope Trigger, Bend, Unison, Output Stage groups with native dependency gating; Bend Down label corrected. `playmode-sub-panel.cpp:511`, `playmode-sub-panel.cpp:895` |
| Default trigger | Metadata offered incorrect choices/range | Legato=0 and Any Key Press=2 match native menu and DSP; accepts value 2 despite stale metadata maximum of 1. `playmode-sub-panel.cpp:690` |

Luna performed read-only audits of the non-source panels and Settings. Findings were verified before implementation: its proposed trigger enum correction and source-power disabling were rejected because the native code contradicts them. Main-thread changes implement the verified findings.

## Validation

- `npm run build`: Vue/TypeScript check and production build pass.
- `NATIVE_PRESETS=../target/push2-native/browser-parity/normalized npm test`: 15 tests pass, including the 216-preset C++ migration comparison and nine rendered-component parity tests.
- Native source screenshots: `../target/push2-native/visual-parity/source-{none,phase,resonant,noise}.png`.
- Browser screenshots: local, git-ignored `output/playwright/*-v2.png`.
- Native waveform samples: `src/data/waveforms.json`, exported by the reference harness. Regression test checks sine quarter-cycle values to catch incorrect phase sampling.

The native harness now accepts `{"op":"source","index":0}`, `{"op":"set","id":1675,"value":1}`, and `{"op":"waveforms"}` for repeatable panel captures and preview-data generation. `set` changes the test patch, not a production plugin instance.

## Remaining differences

- Noise preview is a deterministic illustration rather than a port of the native noise filters/RNG. Phase-map and resonant previews use sampled native waveforms with floating-point versions of the native mappings; they are visualizations, not a second audio engine.
- The native smoothed step-curve overlay is not implemented; step values, count, cycle, deform, and routing remain editable and serialize natively.
- Browser controls and menus are HTML/SVG, with browser focus, scrolling, and text entry behavior. Not every native context-menu copy/paste or display-format convenience is reproduced.
- MPE, MIDI/automation smoothing, and native UI preferences are host state, outside this preset-file component. They are not represented as fake preset controls.
- No automated image similarity threshold or claim of exhaustive state coverage. The regression suite targets structural mistakes and conditional behavior.

## Playback playground validation

The standalone Vue host now loads the branch's compiled WASM engine; the editor component still supports preset-only embedding.

Validated 2026-09-10:
- Release WASM build and direct-WASM smoke pass (2,554 parameters).
- Native headless suite passes: 2,592 assertions, including raw MIDI notes, zero-velocity note-off, sustain/release, mod wheel, channel pressure, pitch bend, and all-sounds-off.
- Browser tests: existing editor/preset suite plus live delta/undo notifications, MIDI selection/filter/disconnect behavior, raw packet encoding, and preset-switch queue clearing.
- Real Chromium AudioWorklet: C4 meter peak ~0.11169; Main Level zero → 0; Undo while held → ~0.11169. Mute and Panic → 0. No UI errors.
- Native preset export followed by import succeeds through the visible UI.
- Web MIDI permission succeeds. No physical MIDI inputs were enumerated in the test browser; hardware-controller validation is still manual.

Evidence: ignored `output/playwright/live-audio.png` and `audio-roundtrip.sxsnp`. See README for setup and A/B instructions. Audio In, host tempo transport, and host MPE configuration are outside this playground's current connections.
