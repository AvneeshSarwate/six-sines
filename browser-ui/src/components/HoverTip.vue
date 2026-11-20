<script setup lang="ts">
// Hover text for any element with a data-tip attribute, shown after a short
// delay (the browser's title tooltip waits about a second and cannot be
// tuned). Lives inside the editor root and positions itself in the root's
// own coordinates, so it also lines up when a host scales the editor (a
// zoomed canvas). The text is re-read every frame while shown, so a value
// readout follows a drag.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ delay?: number }>(), { delay: 180 })
const tip = ref<HTMLDivElement | null>(null)
const text = ref('')
const pos = ref({ x: 0, y: 0, above: false })
const shown = ref(false)
let target: Element | null = null
// A double-click (typing a value) hides the tip until the pointer moves to
// another control
let suppressed = false
let timer = 0
let frame = 0

function root(): HTMLElement | null {
  return (tip.value?.offsetParent as HTMLElement | null) ?? null
}
function place() {
  const host = root()
  if (!target || !host || !target.isConnected) return hide()
  text.value = target.getAttribute('data-tip') ?? ''
  if (!text.value) return hide()
  const h = host.getBoundingClientRect()
  const scale = host.offsetWidth ? h.width / host.offsetWidth : 1
  const r = target.getBoundingClientRect()
  const x = (r.left + r.width / 2 - h.left) / scale
  const below = (r.bottom - h.top) / scale + 6
  const above = (r.top - h.top) / scale - 6
  const flip = below + 30 > host.scrollHeight
  pos.value = { x, y: flip ? above : below, above: flip }
  frame = requestAnimationFrame(place)
}
function show() {
  if (suppressed) return
  shown.value = true
  cancelAnimationFrame(frame)
  place()
}
function hide() {
  shown.value = false
  window.clearTimeout(timer)
  cancelAnimationFrame(frame)
}
function over(e: Event) {
  const next = (e.target as Element | null)?.closest?.('[data-tip]') ?? null
  if (next === target) return
  target = next
  suppressed = false
  hide()
  if (target) timer = window.setTimeout(show, props.delay)
}
function dblclick() {
  suppressed = true
  hide()
}
function leave(e: PointerEvent) {
  const to = e.relatedTarget as Element | null
  if (target && to && target.contains(to)) return
  if (!to?.closest?.('[data-tip]')) {
    target = null
    hide()
  }
}
let host: HTMLElement | null = null
onMounted(() => {
  host = tip.value?.parentElement ?? null
  host?.addEventListener('pointerover', over)
  host?.addEventListener('pointerout', leave as EventListener)
  host?.addEventListener('dblclick', dblclick)
})
onBeforeUnmount(() => {
  host?.removeEventListener('pointerover', over)
  host?.removeEventListener('pointerout', leave as EventListener)
  host?.removeEventListener('dblclick', dblclick)
  hide()
})
</script>
<template>
  <div
    ref="tip"
    class="hover-tip"
    :class="{ shown, above: pos.above }"
    role="tooltip"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
  >
    {{ text }}
  </div>
</template>
