# Native UI reference: validated slice

The macOS `six-sines-ui-reference` target instantiates the same `SixSinesEditor` as
the plugin, linked against `six-sines-impl`. It supplies a Synth for patch/state
ownership and a stub CLAP host. It does not render audio or connect an audio device.

## Run

```sh
cmake -S . -B target/push2-native -DCMAKE_BUILD_TYPE=Release -DCOPY_AFTER_BUILD=OFF
cmake --build target/push2-native --target six-sines-ui-reference -j 6
# Supply an absolute directory for the command channel and evidence:
target/push2-native/tests/six-sines-ui-reference "$PWD/target/push2-native/ui-reference-evidence"
```

From another terminal:

```sh
python3 scripts/ui-reference-smoke.py target/push2-native/ui-reference-evidence
python3 scripts/ui-reference-command.py target/push2-native/ui-reference-evidence '{"op":"quit"}'
```

The harness sets `SIX_SINES_TEST_USER_DATA_DIR` to its evidence directory's
`user-data` subdirectory. This opt-in path override avoids personal preferences,
cloud-backed Documents access, and personal preset/theme changes. Normal plugin
behavior is unchanged unless this environment variable is explicitly set.

## What passed

Two consecutive complete smoke runs passed on macOS arm64 on 2026-09-10:

1. Export/load an Init fixture and capture the editor.
2. Inject mouse-down/up into the real Op 5 to Op 6 knob handlers to select its panel.
3. Open the real source popup and navigate with its keyboard handler through Macros
   to Macro 1 Amplitude; capture every step including the nested submenu.
4. Select Level in the real target popup, enable the route, and drag its depth slider.
5. Export the native preset and assert exactly four changed parameters:
   32801=1 (route active), 32870=400 (source), 32880=10 (target), and
   32871 approximately 0.523809552193 (dragged modulation depth).
6. Reload that preset through the native loader and compare all parameter values
   after a second export.

Evidence: `smoke-result.json`, `smoke-before.sxsnp`, `smoke-after.sxsnp`,
`smoke-roundtrip.sxsnp`, `smoke-route.png`, `source-key-6.png` (nested Macros menu),
and `smoke-assigned.png`. Screenshots were visually inspected as well as generated.

## Steering and capture boundaries

Commands are single-client JSON files consumed on the JUCE message thread. Supported
operations are capture, export, load, tree, click, drag, key, and quit. Named control
lookup is intentionally limited to this slice: route, power, source, target, depth.

Screenshots use JUCE component snapshots, compositing additional visible desktop
components. The tested popups are rendered by the actual JUCE menu code. This is
not an OS screenshot and does not prove coverage of native file dialogs or windows
owned by other processes.

Input is injected into actual control mouse handlers and modal menu keyboard
handlers; it is not OS-level pointer/keyboard injection or full JUCE peer event
dispatch. The harness moves the real pointer, so avoid interacting during a run.
Popup menus can disappear between separate commands in this terminal-launched
app. The validated `click` command's `keys` array executes navigation and per-step
captures atomically, before returning to the event loop. It explicitly targets
the active modal component: falling back to keyboard focus caused an earlier
repeatability failure and was removed.

The smoke test proves native navigation, nested menu capture, editing, and preset
round-trip for this slice. It does not yet prove browser parity, pixel-identical
repeatability, external accessibility automation, or hosted-VST equivalence.
It does not test audio-dependent state or sustained queue processing.

Next: package this as a macOS app for normal foreground/focus behavior, validate
OS/accessibility input, add stable control IDs and broader state fixtures, then
replay the same semantic actions against the browser editor.
