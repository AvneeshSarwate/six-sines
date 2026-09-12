<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { byId, editorKey, field, schema, type Choice } from '../model'
import ParamField from './ParamField.vue'
import Knob from './Knob.vue'
import SourceControls from './SourceControls.vue'
import NodeControls from './NodeControls.vue'
import StepSequencer from './StepSequencer.vue'
const s = inject(editorKey)!,
  n = s.selection
const f = (suffix: string) => field(n.value, suffix)
const v = (suffix: string) => {
  const p = f(suffix)
  return p ? (s.state.values[p.id] ?? 0) : 0
}
const audioIn = computed(
  () =>
    (n.value.kind === 'source' && v('Waveform') === 21) ||
    (n.value.kind === 'feedback' && n.value.index === 0 && s.state.values[1505] === 21),
)
const nodeDisabled = computed(() => audioIn.value || (n.value.kind === 'macro' && !v('Power')))
const targetAvailable = (id: number) =>
  n.value.kind !== 'source' ||
  (id === 18 ? [1, 2, 3].includes(v('Extended Mode')) : id === 19 ? v('Extended Mode') === 3 : true)
const envSettings = ref(false)
const copied = ref<{ kind: string; values: number[] } | null>(null)
watch(n, () => {
  envSettings.value = false
})
const sourceGroups = computed(() => {
  const groups = new Map<string, Choice[]>()
  for (const choice of schema.sources) {
    if (
      n.value.kind === 'macro' &&
      ((choice.value >= 400 && choice.value < 406 && choice.value - 400 >= n.value.index) ||
        (choice.value >= 410 && choice.value < 416 && choice.value - 410 >= n.value.index))
    )
      continue
    const key = choice.group || 'General'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(choice)
  }
  return groups
})
function copy() {
  copied.value = { kind: n.value.kind, values: n.value.params.map((id) => s.state.values[id]!) }
  s.notice.value = 'Node copied'
}
function paste() {
  if (copied.value?.kind !== n.value.kind) return
  s.begin()
  n.value.params.forEach((id, i) => s.set(id, copied.value!.values[i]!))
  s.end()
}
</script>
<template>
  <section
    class="inspector panel"
    aria-label="Node editor"
  >
    <header class="inspector-title">
      <span class="rule"></span>
      <h2>{{ n.group.replace(' to ', ' → ') }}</h2>
      <span class="rule"></span>
      <details class="node-menu">
        <summary aria-label="Node actions">•••</summary>
        <div class="popover">
          <button @click="copy">Copy node</button
          ><button
            :disabled="copied?.kind !== n.kind"
            @click="paste"
          >
            Paste node
          </button>
        </div>
      </details>
    </header>
    <div class="inspector-scroll">
      <div
        class="modulator-pair"
        :inert="nodeDisabled"
        :class="{ disabled: nodeDisabled }"
      >
        <section class="envelope">
          <h3>
            <span>Envelope</span
            ><ParamField
              :param="f('Env Temposync')"
              label="Sync"
              toggle
              compact
            />
          </h3>
          <div class="envelope-top">
            <button
              class="trigger-button"
              aria-label="Envelope trigger settings"
              :aria-expanded="envSettings"
              @click="envSettings = !envSettings"
            >
              {{ ['L', 'S', 'K', 'D', 'R'][v('Env Trigger Mode')] || 'D'
              }}{{ v('Is OneShot') && v('Env Trigger Mode') !== 4 ? '¹' : '' }}</button
            ><Knob
              v-for="suffix in ['Attack Shape', 'Decay Shape', 'Release Shape']"
              :key="suffix"
              :id="f(suffix)!.id"
              small
            />
          </div>
          <div class="env-sliders">
            <ParamField
              v-for="(suffix, i) in ['Delay', 'Attack', 'Hold', 'Decay', 'Sustain', 'Release']"
              :key="suffix"
              :param="f('Env ' + suffix)"
              :label="['D', 'A', 'H', 'D', 'S', 'R'][i]"
              vertical
            />
          </div>
        </section>
        <section class="lfo">
          <h3>
            <span>LFO</span
            ><ParamField
              :param="f('Temposync')"
              label="Sync"
              toggle
              compact
            />
          </h3>
          <div class="lfo-columns">
            <div class="lfo-shapes">
              <div
                class="shape-list"
                role="group"
                aria-label="LFO waveform"
              >
                <button
                  v-for="(shape, i) in [
                    'Sine',
                    'Ramp',
                    'Sawtooth',
                    'Triangle',
                    'Pulse',
                    'Noise',
                    'S and H',
                    'Step',
                  ]"
                  :key="shape"
                  :class="{ chosen: v('LFO Shape') === i }"
                  @click="s.set(f('LFO Shape')!.id, i)"
                >
                  {{ shape }}
                </button>
              </div>
              <ParamField
                :param="f('Bipolar')"
                toggle
                :disabled="v('LFO Shape') === 7"
                compact
              />
            </div>
            <div class="lfo-rate">
              <Knob
                :id="f('LFO Rate')!.id"
                label="Rate"
              /><ParamField
                :param="f('LFO Deform')"
                label="D"
                compact
              /><ParamField
                :param="f('Start Phase')"
                label="φ"
                compact
              /><ParamField
                :param="f('Is Enveloped')"
                label="× Env"
                toggle
                compact
              /><ParamField
                :param="f('LFO Run Mode')"
                label=""
                compact
              />
            </div>
            <StepSequencer />
          </div>
        </section>
      </div>
      <div
        v-if="envSettings"
        class="env-settings"
        :inert="nodeDisabled"
        :class="{ disabled: nodeDisabled }"
      >
        <ParamField
          v-for="suffix in ['Env Trigger Mode', 'Is OneShot', 'Triggers from Zero']"
          :key="suffix"
          :param="f(suffix)"
          :disabled="suffix === 'Is OneShot' && v('Env Trigger Mode') === 4"
          :blocked-values="suffix === 'Env Trigger Mode' && n.kind === 'main' ? [1, 4] : []"
        />
      </div>
      <SourceControls v-if="n.kind === 'source'" />
      <div
        v-else
        :inert="nodeDisabled"
        :class="{ disabled: nodeDisabled }"
      >
        <NodeControls />
      </div>
      <div
        v-if="n.kind === 'macro'"
        class="macro-name"
      >
        <label
          >Macro name<input
            :value="s.state.macros[n.index]"
            maxlength="40"
            aria-label="Macro name"
            @change="
              s.editMetadata(
                () => (s.state.macros[n.index] = ($event.target as HTMLInputElement).value),
              )
            "
        /></label>
        <p>Amplitude is the knob. Modulated includes this envelope and LFO.</p>
      </div>
      <section
        v-if="n.kind === 'macro'"
        class="used-by"
      >
        <h3>Used by · {{ s.uses(n.index).length }}</h3>
        <p v-if="!s.uses(n.index).length">
          No assignments yet. Choose this macro in a node’s Other Modulation section.
        </p>
        <button
          v-for="u in s.uses(n.index)"
          :key="u.n.group + u.slot"
          @click="s.selection.value = u.n"
        >
          {{ u.n.group }} → {{ u.target }} <span>↗</span>
        </button>
      </section>
    </div>
    <section
      class="other-modulation"
      :inert="nodeDisabled"
      :class="{ disabled: nodeDisabled }"
    >
      <h3><span class="rule"></span>Other Modulation<span class="rule"></span></h3>
      <div
        v-for="i in 3"
        :key="i"
        class="mod-slot"
      >
        <select
          :aria-label="`Modulation source ${i}`"
          :value="s.state.values[n.modSource[i - 1]!]"
          @change="s.assign(n, i - 1, Number(($event.target as HTMLSelectElement).value))"
        >
          <optgroup
            v-for="[group, choices] in sourceGroups"
            :key="group"
            :label="group"
          >
            <option
              v-for="o in choices"
              :key="o.value"
              :value="o.value"
            >
              {{ o.label }}
            </option>
          </optgroup>
        </select>
        <select
          :aria-label="`Modulation target ${i}`"
          :value="s.state.values[n.modTarget[i - 1]!]"
          @change="s.set(n.modTarget[i - 1]!, Number(($event.target as HTMLSelectElement).value))"
        >
          <option
            v-for="o in n.targets"
            :disabled="!targetAvailable(o.value)"
            :key="o.value"
            :value="o.value"
          >
            {{ o.label }}
          </option>
        </select>
        <ParamField
          :param="byId.get(n.modDepth[i - 1]!)"
          :label="''"
          compact
        />
      </div>
    </section>
  </section>
</template>
