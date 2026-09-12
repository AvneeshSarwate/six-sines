<script setup lang="ts">
import { computed, inject } from 'vue'
import { editorKey, field } from '../model'
import Knob from './Knob.vue'
import ParamField from './ParamField.vue'
import SourceWave from './SourceWave.vue'
const s = inject(editorKey)!
const n = s.selection
const f = (name: string) => field(n.value, name)!
const v = (name: string) => s.state.values[f(name).id]!
const audioIn = computed(() => v('Waveform') === 21)
const mode = computed(() => v('Extended Mode'))
const noiseN = computed(() => [2, 3].includes(v('Noise Type')))
const unison = computed(() => s.state.values[530]! > 1)
const waveChoices = computed(() =>
  f('Waveform').options.filter((o) => n.value.index === 0 || o.value !== 21),
)
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
        <SourceWave />
        <ParamField
          :param="f('Waveform')"
          :choices="waveChoices"
          label="Waveform"
        />
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
          <ParamField
            v-if="mode === 1"
            :param="f('Phase Map Shape')"
            label="Phase Map"
            :disabled="audioIn"
            buttons
          />
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
