<script setup lang="ts">
import { inject } from 'vue'
import { byId, editorKey } from '../model'
import ParamField from './ParamField.vue'
const s = inject(editorKey)!
defineProps<{ search?: string }>()
const groups = [
  {
    name: 'Play',
    fields: [
      [523, 'Mode'],
      [528, 'Portamento'],
      [543, 'Continuation'],
      [529, 'Piano Mode'],
      [526, 'Voice Limit'],
      [535, 'Octave'],
    ],
  },
  {
    name: 'Default Envelope Trigger',
    fields: [
      [527, 'Trigger'],
      [539, 'Reset Phase on Retrigger'],
      [538, 'Attack Floored on Retrigger'],
    ],
  },
  {
    name: 'Bend',
    fields: [
      [524, 'Bend Up'],
      [525, 'Bend Down'],
    ],
  },
  {
    name: 'Unison',
    fields: [
      [530, 'Voices'],
      [531, 'Spread'],
      [542, 'Stereo Field'],
      [532, 'Random Phase'],
    ],
  },
  {
    name: 'Output Stage',
    fields: [
      [540, 'Sample Rate'],
      [541, 'Resampler'],
      [550, 'Saturation'],
      [551, 'Drive'],
      [558, 'Ultrasonic Filter'],
      [552, 'Low Pass'],
      [553, 'Bit Rate'],
      [557, 'ZOH Pre-Filter'],
      [554, 'Bit Depth'],
      [555, 'High Pass'],
      [556, 'Gain'],
    ],
  },
] as { name: string; fields: [number, string][] }[]
function disabled(id: number) {
  const v = s.state.values
  return [528, 543].includes(id)
    ? !v[523]
    : id === 529
      ? !!v[523]
      : [531, 542, 532].includes(id)
        ? v[530]! < 1.5
        : id === 557
          ? !v[553]
          : id === 539
            ? !!v[532] && v[530] !== 1
            : false
}
const triggerChoices = [
  { value: 0, label: 'On Start or In Release (Legato)' },
  { value: 2, label: 'On Any Key Press' },
]
</script>
<template>
  <div class="play-settings">
    <section
      v-for="group in groups"
      :key="group.name"
      v-show="
        group.fields.some(([id, label]) =>
          (group.name + ' ' + label + ' ' + byId.get(id)!.name)
            .toLowerCase()
            .includes((search ?? '').toLowerCase()),
        )
      "
    >
      <h3>{{ group.name }}</h3>
      <ParamField
        v-for="[id, label] in group.fields.filter(([id, label]) =>
          (group.name + ' ' + label + ' ' + byId.get(id)!.name)
            .toLowerCase()
            .includes((search ?? '').toLowerCase()),
        )"
        :key="id"
        :param="byId.get(id)"
        :label="label"
        :disabled="disabled(id)"
        :choices="id === 527 ? triggerChoices : undefined"
      />
    </section>
  </div>
</template>
