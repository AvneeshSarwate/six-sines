<script setup lang="ts">
import { inject } from 'vue'
import { editorKey, field } from '../model'
import ParamField from './ParamField.vue'
const s = inject(editorKey)!,
  n = s.selection
const f = (suffix: string) => field(n.value, suffix)!
const v = (suffix: string) => s.state.values[f(suffix).id]!
</script>
<template>
  <section
    class="step-sequencer"
    aria-label="Step sequencer"
  >
    <div
      class="sequence-grid"
      :class="{ inactive: v('LFO Shape') !== 7 }"
    >
      <template v-if="v('LFO Shape') === 7">
        <input
          v-for="i in Math.max(1, Math.min(16, Math.round(v('Step Count'))))"
          :key="i"
          type="range"
          min="-1"
          max="1"
          step="any"
          :aria-label="f('Seq Step ' + (i - 1)).name"
          :value="v('Seq Step ' + (i - 1))"
          @pointerdown="s.begin"
          @pointerup="s.end"
          @input="
            s.set(f('Seq Step ' + (i - 1)).id, Number(($event.target as HTMLInputElement).value))
          "
          @change="s.end"
        />
      </template>
    </div>
    <div class="sequence-options">
      <ParamField
        :param="f('Step Count')"
        label="Steps"
        :disabled="v('LFO Shape') !== 7"
        compact
      /><ParamField
        :param="f('Cycle')"
        label="cyc"
        :disabled="v('LFO Shape') !== 7"
        compact
      />
    </div>
  </section>
</template>
