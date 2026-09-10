<script setup lang="ts">
import { computed, inject } from 'vue'
import { display, editorKey, shortName, type Choice, type Parameter } from '../model'
const props = defineProps<{ param?: Parameter; label?: string; vertical?: boolean; compact?: boolean; disabled?: boolean; choices?: Choice[]; blockedValues?: number[]; buttons?: boolean; toggle?: boolean }>()
const s = inject(editorKey)!, p = computed(() => props.param)
const value = computed(() => p.value ? s.state.values[p.value.id] ?? p.value.default : 0)
const options = computed(() => p.value?.name.endsWith('Env Trigger Mode') ? [ {value:0,label:'Legato'},{value:1,label:'Voice start'},{value:2,label:'Any key press'},{value:3,label:'Patch default'},{value:4,label:'On release'} ] : props.choices ?? p.value?.options ?? [])
function update(e: Event) { if (p.value) s.set(p.value.id, Number((e.target as HTMLInputElement).value)) }
</script>
<template>
 <label v-if="p" class="param-field" :class="{vertical,compact, disabled}" :title="`${p.name}: ${display(p,value)}`">
   <span v-if="!toggle">{{ label ?? shortName(p) }}</span>
   <button v-if="toggle" class="param-toggle" :disabled="disabled" :aria-label="p.name" :aria-pressed="value>0.5" :class="{chosen:value>0.5}" @click="s.set(p.id,value>0.5?0:1)">{{label ?? shortName(p)}}</button>
   <div v-else-if="buttons && options.length" class="choice-buttons" role="group" :aria-label="p.name"><button v-for="o in options" :aria-label="o.label" :key="o.value" :disabled="disabled || blockedValues?.includes(o.value)" :aria-pressed="value===o.value" :class="{chosen:value===o.value}" @click="s.set(p.id,o.value)">{{o.label}}</button></div>
   <select v-else-if="options.length" :disabled="disabled" :aria-label="p.name" :value="value" @change="update"><option v-if="!options.some(o=>o.value===value)" :value="value">{{ value }} (retained)</option><option v-for="o in options" :disabled="blockedValues?.includes(o.value)" :key="o.value" :value="o.value">{{ o.label }}</option></select>
   <input v-else-if="p.type===1" type="number" :disabled="disabled" :aria-label="p.name" :min="p.min" :max="p.max" step="1" :value="value" @change="update"/>
   <input v-else-if="p.type===2" type="checkbox" :disabled="disabled" :aria-label="p.name" :checked="value>0.5" @change="s.set(p.id,($event.target as HTMLInputElement).checked?1:0)" />
   <template v-else><input type="range" :disabled="disabled" :aria-label="p.name" :min="p.min" :max="p.max" :step="p.type===1?1:'any'" :value="value" :style="{'--fill':`${(value-p.min)/(p.max-p.min)*100}%`}" @pointerdown="s.begin" @pointerup="s.end" @input="update" @change="s.end" /><output v-if="!vertical && !compact">{{ display(p,value) }}</output></template>
 </label>
</template>
