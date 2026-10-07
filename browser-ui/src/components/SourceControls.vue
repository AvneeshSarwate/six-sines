<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { editorKey, field } from '../model'
import { useOperatorTable } from '../useWavetable'
import { AUDIO_IN, USER_TABLE, wavetableFor } from '../wavetable'
import Knob from './Knob.vue'
import ParamField from './ParamField.vue'
import SourceWave from './SourceWave.vue'
const s = inject(editorKey)!
const n = s.selection
const f = (name: string) => field(n.value, name)!
const v = (name: string) => s.state.values[f(name).id]!
const audioIn = computed(() => v('Waveform') === AUDIO_IN)
const mode = computed(() => v('Extended Mode'))
const noiseN = computed(() => [2, 3].includes(v('Noise Type')))
const unison = computed(() => s.state.values[530]! > 1)
const table = useOperatorTable(s, n)
// A loaded table stays referenced after switching away, so it can be selected again.
const loaded = computed(() => wavetableFor(s.state.xml, n.value.index))
const onWavetable = computed(() => v('Waveform') === USER_TABLE)
// Morph only means something with more than one frame; native hides it otherwise.
const showMorph = computed(() => (table.value?.frames.length ?? 0) > 1)
const direct = computed(() => [2, 3].includes(v('Wavetable Playback')))
const waveChoices = computed(() =>
  f('Waveform')
    .options.filter((o) => n.value.index === 0 || o.value !== AUDIO_IN)
    .map((o) =>
      o.value !== USER_TABLE
        ? o
        : {
            ...o,
            label: loaded.value
              ? `Wavetable: ${loaded.value.name || '(unnamed)'}`
              : 'Wavetable (Sine to Saw)',
          },
    ),
)
const fileInput = ref<HTMLInputElement>()
async function pickWavetable(e: Event) {
  const input = e.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  await s.loadWavetable(
    n.value.index,
    new Uint8Array(await file.arrayBuffer()),
    file.name.replace(/\.[^.]+$/, ''),
  )
}
const readPhaseJumps = [
  { value: 0, label: '0' },
  { value: 0.25, label: 'π/4' },
  { value: 0.5, label: 'π/2' },
]
</script>

<template>
  <section
    class="source-controls"
    aria-label="Oscillator controls"
  >
    <div class="source-primary">
      <section
        v-for="modulator in ['Env', 'LFO']"
        :key="modulator"
        class="pitch-depths"
      >
        <h3>{{ modulator }} →</h3>
        <Knob
          :id="f(modulator + ' to Ratio').id"
          label="Coarse"
          :disabled="audioIn"
        />
        <Knob
          :id="f(modulator + ' to Ratio (Fine)').id"
          label="Fine"
          :disabled="audioIn"
        />
      </section>
      <section class="source-pitch">
        <h3>Pitch</h3>
        <ParamField
          :param="f('Octave Transpose')"
          label="Oct"
          :disabled="audioIn || !v('Keytrack')"
          compact
        />
        <ParamField
          :param="f('Keytrack')"
          label="Key Track"
          toggle
        />
        <ParamField
          :param="f('Keytrack Frequency is Low Frequency')"
          label="Lo"
          toggle
          :disabled="audioIn || !!v('Keytrack')"
          compact
        />
        <ParamField
          :param="
            f(
              v('Keytrack Frequency is Low Frequency')
                ? 'Keytrack Frequency at Ratio=1 (Low Frequency)'
                : 'Absolute Frequency at Ratio=1',
            )
          "
          label=""
          compact
          :disabled="audioIn || !!v('Keytrack')"
        />
        <ParamField
          :param="f('Absolute Offset')"
          label="Abs"
          compact
        />
        <details class="unison-options">
          <summary :aria-disabled="!unison">Unison</summary>
          <ParamField
            :param="f('Unison Participation')"
            label="Participates in"
            :disabled="!unison"
          />
          <ParamField
            :param="f('Unison Main Output')"
            label="To Main"
            :disabled="!unison"
            :blocked-values="s.state.values[530]! % 2 ? [] : [1, 2]"
          />
          <ParamField
            :param="f('Unison Operator Output Output')"
            label="To Op Out"
            :disabled="!unison"
            :blocked-values="s.state.values[530]! % 2 ? [] : [1, 2]"
          />
        </details>
      </section>
      <section class="source-wave">
        <h3>Wave</h3>
        <div :class="{ 'wave-with-morph': showMorph }">
          <SourceWave />
          <div
            v-if="showMorph"
            class="morph-depths"
          >
            <Knob
              :id="f('Env to Wavetable Morph').id"
              label="env"
            />
            <Knob
              :id="f('LFO to Wavetable Morph').id"
              label="lfo"
            />
          </div>
        </div>
        <ParamField
          v-if="showMorph"
          :param="f('Wavetable Morph')"
          label="morph"
        />
        <ParamField
          :param="f('Waveform')"
          :choices="waveChoices"
          label="Waveform"
        />
        <div
          class="wavetable-tools"
          aria-label="Wavetable"
        >
          <p
            v-if="table"
            class="wavetable-name"
            :class="{ error: table.error }"
          >
            {{
              table.error
                ? 'Failed: ' + table.error
                : `${table.name || '(unnamed)'} · ${table.frames.length} ${table.frames.length === 1 ? 'frame' : 'frames'}`
            }}
          </p>
          <div class="wavetable-buttons">
            <button
              type="button"
              @click="fileInput?.click()"
            >
              Load Wavetable…
            </button>
            <button
              type="button"
              :disabled="!loaded"
              @click="s.clearWavetable(n.index)"
            >
              Clear
            </button>
            <input
              ref="fileInput"
              type="file"
              accept=".wt,.wav"
              hidden
              @change="pickWavetable"
            />
          </div>
          <template v-if="onWavetable || loaded">
            <ParamField
              :param="f('Wavetable Playback')"
              label="Playback"
              :disabled="!onWavetable"
            />
            <ParamField
              :param="f('Wavetable Mip Chain')"
              label="Mip Chain"
              toggle
              :disabled="!onWavetable || direct"
            />
          </template>
        </div>
        <ParamField
          :param="f('Phase')"
          label="φ"
          :disabled="audioIn"
        />
      </section>
    </div>

    <section
      class="extend-section"
      aria-label="Extended Mode"
    >
      <div class="extend-heading">
        <span class="rule"></span
        ><ParamField
          :param="f('Extended Mode')"
          label="Extended Mode"
          :disabled="audioIn"
          compact
        /><span class="rule"></span>
      </div>
      <div
        v-if="mode"
        class="extend-body"
        :class="{ 'noise-body': mode === 3 }"
      >
        <div class="extend-options">
          <template v-if="mode === 1">
            <ParamField
              :param="f('Phase Map Shape')"
              label="Phase Map"
              :disabled="audioIn"
              buttons
            />
            <ParamField
              :param="f('Phase Map Read Phase')"
              label="θ off"
              :disabled="audioIn"
            />
            <div
              class="choice-buttons read-phase-jumps"
              role="group"
              aria-label="Phase Map Read Phase presets"
            >
              <button
                v-for="j in readPhaseJumps"
                :key="j.label"
                type="button"
                :disabled="audioIn"
                :class="{ chosen: Math.abs(v('Phase Map Read Phase') - j.value) < 1e-6 }"
                @click="s.set(f('Phase Map Read Phase').id, j.value)"
              >
                {{ j.label }}
              </button>
            </div>
          </template>
          <template v-if="mode === 2">
            <ParamField
              :param="f('Resonant Sweep Window')"
              label="Window"
              :disabled="audioIn"
              buttons
            />
            <ParamField
              :param="f('Sweep Depth')"
              label="Depth"
              :disabled="audioIn"
            />
          </template>
          <template v-if="mode === 3">
            <ParamField
              :param="f('Noise Mode')"
              label="Mode"
              :disabled="audioIn"
            />
            <ParamField
              :param="f('Noise Type')"
              label="Type"
              :disabled="audioIn"
            />
            <ParamField
              v-if="v('Noise Type') === 3"
              :param="f('LFSR Mode')"
              label="LFSR"
              :disabled="audioIn"
            />
          </template>
        </div>
        <div class="extend-visual">
          <SourceWave extended />
          <div class="extend-knobs">
            <template
              v-for="axis in mode === 3 ? ['M', 'N'] : ['M']"
              :key="axis"
            >
              <Knob
                :id="f('Extended Mode ' + axis).id"
                :label="axis"
                :disabled="audioIn || (axis === 'N' && !noiseN)"
              />
              <Knob
                :id="f('Env to Extended Mode ' + axis).id"
                :label="'Env → ' + axis"
                :disabled="audioIn || (axis === 'N' && !noiseN)"
              />
              <Knob
                :id="f('LFO to Extended Mode ' + axis).id"
                :label="'LFO → ' + axis"
                :disabled="audioIn || (axis === 'N' && !noiseN)"
              />
            </template>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>
