<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { byId, display, editorKey, readDisplay } from '../model'
const props = defineProps<{ id: number; label?: string; small?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ select: [] }>()
const store = inject(editorKey)!
const p = computed(() => byId.get(props.id)!)
const value = computed(() => store.state.values[props.id] ?? p.value.default)
const normalized = computed(() => Math.min(1, Math.max(0, (value.value - p.value.min) / (p.value.max - p.value.min))))
const angle = computed(() => -135 + normalized.value * 270)
const baseline = computed(() => p.value.min < 0 && p.value.max > 0 ? -p.value.min / (p.value.max - p.value.min) : 0)
const editing = ref(false), text = ref('')
let startY = 0, startValue = 0
function down(e: PointerEvent) { if (props.disabled || e.button !== 0) return; emit('select'); store.begin(); startY = e.clientY; startValue = value.value; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
function move(e: PointerEvent) { if (props.disabled || !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return; store.set(props.id, startValue + (startY - e.clientY) / (e.shiftKey ? 1600 : 160) * (p.value.max - p.value.min)) }
function up() { store.end() }
function edit() { if (props.disabled) return; text.value = display(p.value, value.value); editing.value = true }
function commit() { try { store.set(props.id, readDisplay(p.value, text.value)); editing.value = false } catch (e) { store.error.value = String(e) } }
function key(e: KeyboardEvent) { if (props.disabled) return; const d = p.value.type ? 1 : (p.value.max - p.value.min) / (e.shiftKey ? 1000 : 100); if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { store.set(props.id, value.value + d); e.preventDefault() } if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { store.set(props.id, value.value - d); e.preventDefault() } if (e.key === 'Home') store.set(props.id, p.value.min); if (e.key === 'End') store.set(props.id, p.value.max); if (e.key === 'Enter') edit() }
</script>
<template>
  <div class="knob-wrap" :class="{ small, disabled }">
    <div class="knob" role="slider" :tabindex="disabled ? -1 : 0" :aria-disabled="disabled || undefined" :aria-label="p.name" :aria-valuemin="p.min" :aria-valuemax="p.max" :aria-valuenow="value" :aria-valuetext="display(p,value)" :title="`${p.name}: ${display(p,value)} · Double-click to type · Alt-click to reset`" :data-param-id="id"
      @pointerdown="down" @pointermove="move" @pointerup="up" @lostpointercapture="up" @dblclick="edit" @keydown="key" @click.alt="!disabled && store.set(id,p.default)">
      <svg viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="face"><stop offset="0" stop-color="#626262"/><stop offset="1" stop-color="#4c4c4c"/></radialGradient></defs><circle cx="32" cy="32" r="29" fill="#111"/><path d="M 12.2 51.8 A 28 28 0 1 1 51.8 51.8" fill="none" stroke="#424242" stroke-width="4"/><path d="M 12.2 51.8 A 28 28 0 1 1 51.8 51.8" fill="none" stroke="var(--accent)" stroke-width="4" pathLength="100" :stroke-dasharray="`${Math.abs(normalized-baseline)*100} 100`" :stroke-dashoffset="-Math.min(normalized,baseline)*100"/><circle cx="32" cy="32" r="23.5" fill="url(#face)" stroke="#393939" stroke-width="2"/><path d="M32 8 L32 23" stroke="#aaa" stroke-width="2" :transform="`rotate(${angle} 32 32)`"/></svg>
    </div>
    <input v-if="editing" v-model="text" class="knob-entry" :aria-label="`${p.name} value`" @keydown.enter="commit" @keydown.esc="editing=false" @change="commit" />
    <span v-if="label" class="knob-label">{{ label }}</span>
  </div>
</template>
