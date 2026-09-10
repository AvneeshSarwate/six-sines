<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import SixSinesEditor from './SixSinesEditor.vue'
import { useAudio } from './audio'
import { MidiInput } from './midi'
const editor = ref<InstanceType<typeof SixSinesEditor>>()
const audio = useAudio(() => editor.value!.exportPreset())
const {status, error, muted, volume, peak, detail} = audio
const inputs = ref<{id: string; name: string}[]>([]), selected = ref(''), channel = ref(-1), midiError = ref(''), activity = ref('No MIDI received'), midiEnabled = ref(false), busy = ref(false)
const midi = new MidiInput(bytes => { activity.value = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' '); audio.midi(bytes) }, audio.panic, () => {
  inputs.value = Array.from(midi.access?.inputs.values() ?? []).filter(p => p.state !== 'disconnected').map(p => ({id: p.id, name: p.name || p.id}))
  selected.value = midi.selected?.id ?? ''
})
async function enableMidi() {
  busy.value = true; midiError.value = ''
  try { await midi.enable(); midiEnabled.value = true; if (!midi.selected && inputs.value[0]) await midi.select(inputs.value[0].id) }
  catch (e) { midiError.value = String(e) }
  finally { busy.value = false }
}
async function selectMidi(event: Event) {
  busy.value = true; midiError.value = ''
  try { await midi.select((event.target as HTMLSelectElement).value) } catch(e) { midiError.value = String(e) } finally { busy.value = false }
}
const held = new Map<number, number>(), pressed = ref<number[]>([])
function noteDown(e: PointerEvent, key: number) {
  if (status.value !== 'Running') return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  held.set(e.pointerId, key); pressed.value = [...held.values()]
  audio.midi([0x90, key, 100])
}
function noteUp(e: PointerEvent) {
  const key = held.get(e.pointerId)
  if (key !== undefined) { audio.midi([0x80, key, 0]); held.delete(e.pointerId); pressed.value = [...held.values()] }
}
function panic() { held.clear(); pressed.value = []; audio.panic() }
onBeforeUnmount(() => midi.dispose())
</script>

<template>
  <section class="audio-toolbar" aria-label="Browser playback">
    <div class="audio-row"><strong>Browser parity</strong><button :disabled="status==='Starting' || status==='Running'" @click="audio.start">{{status==='Starting' ? 'Starting…' : status==='Paused' ? 'Resume audio' : 'Start audio'}}</button><span role="status">{{status}}</span><button :aria-pressed="muted" @click="muted=!muted">{{muted ? 'Unmute browser' : 'Mute browser'}}</button><button @click="panic">Panic</button><label>Monitor <input v-model.number="volume" type="range" min="-48" max="6" step="1" aria-label="Monitor gain"/>{{volume}} dB</label><meter min="0" max="1" :value="peak" aria-label="Browser output level"/><small>{{peak > 0.00001 ? (20*Math.log10(peak)).toFixed(1)+' dBFS' : 'Silent'}}</small></div>
    <div class="audio-row"><button :disabled="busy" @click="enableMidi">{{midiEnabled ? 'Refresh MIDI' : 'Enable MIDI'}}</button><label>MIDI input <select :value="selected" :disabled="!midiEnabled || busy" @change="selectMidi"><option value="">None</option><option v-for="input in inputs" :key="input.id" :value="input.id">{{input.name}}</option></select></label><label>Channel <select v-model.number="channel" @change="midi.setChannel(channel)"><option :value="-1">All</option><option v-for="n in 16" :key="n" :value="n-1">{{n}}</option></select></label><small>{{midiEnabled && !inputs.length ? 'No MIDI inputs connected' : activity}}</small><div class="test-keys"><button v-for="(name,i) in ['C4','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B']" :key="i" :disabled="status!=='Running'" :class="{held:pressed.includes(60+i), black:name.includes('♯')}" :aria-label="'Play '+name" @pointerdown.prevent="noteDown($event,60+i)" @pointerup="noteUp" @pointercancel="noteUp" @lostpointercapture="noteUp" @keydown.space.prevent="!$event.repeat && audio.midi([0x90,60+i,100])" @keyup.space.prevent="audio.midi([0x80,60+i,0])" @blur="audio.midi([0x80,60+i,0])">{{name}}</button></div></div>
    <p>Edits play live. Import/export .sxsnp presets to share with the plugin. Mute the browser or Ableton track to compare. Monitor gain is separate from the preset.</p>
    <small v-if="detail">{{detail}}</small><p v-if="error || midiError" role="alert">{{error || midiError}}</p>
  </section>
  <SixSinesEditor ref="editor" playable @parameters="audio.parameters" @preset-load="audio.load" />
</template>

<style>
.audio-toolbar { margin: 12px auto 0; max-width: 1580px; padding: 12px 18px; background: #252525; color: #ddd; border-radius: 8px; font: 13px system-ui; }
.audio-row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
.audio-row label { display:flex; align-items:center; gap:6px; }
.audio-toolbar button,.audio-toolbar select { background:#333; color:#eee; border:1px solid #666; border-radius:4px; padding:6px 10px; }
.audio-toolbar button:disabled { opacity:.5; }
.audio-toolbar p { margin:6px 0; }
.test-keys { display:flex; gap:2px; touch-action:none; }
.test-keys button { background:#ddd; color:#222; padding:7px; }
.test-keys .black { background:#111; color:#ddd; }
.test-keys .held { background:#ff9d00; color:#111; }
.audio-toolbar [role=alert] { color:#ffb99f; }
</style>
