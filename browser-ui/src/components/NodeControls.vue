<script setup lang="ts">
import { computed, inject } from 'vue'
import { editorKey, field } from '../model'
import Knob from './Knob.vue'
import ParamField from './ParamField.vue'
const s=inject(editorKey)!, n=s.selection
const f=(suffix:string)=>field(n.value,suffix)!
const v=(suffix:string)=>s.state.values[f(suffix)?.id] ?? 0
const scaled=computed(()=>v('Env is Multiplicative')>0.5)
const envField=computed(()=>n.value.kind==='macro'?'Env Depth':n.value.kind==='feedback'?'Env to FB Amplitude':'EnvToLevel')
const lfoField=computed(()=>n.value.kind==='macro'?'LFO Depth':n.value.kind==='feedback'?'LFO to FB Amplitude':n.value.kind==='mixer'?'LFO to Level':'LFO to Depth')
const lfoMode=computed(()=>n.value.kind==='feedback'?'LFO FB Mode':n.value.kind==='matrix'?'LFO Depth Mode':'LFO Level Mode')
</script>
<template>
  <div v-if="n.kind==='main'" class="native-control-group"><h3>Mod</h3><div class="control-knobs"><Knob :id="f('Velocity Sensitivity').id" label="Vel Sens"/><Knob :id="f('LFO Depth').id" label="LFO →"/></div></div>
  <div v-else-if="n.kind==='pan'" class="native-control-group"><h3>Pan</h3><div class="control-knobs"><Knob :id="f('Env Depth').id" label="Env →"/><Knob :id="f('LFO Depth').id" label="LFO →"/></div></div>
  <div v-else-if="n.kind==='tune'" class="tune-controls">
    <section class="native-control-group"><h3>Tune</h3><div class="control-knobs"><Knob :id="536" label="Fine"/><Knob :id="f('Coarse Tuning').id" label="Coarse"/></div></section>
    <section class="native-control-group"><h3>Env Depth</h3><div class="control-knobs"><Knob :id="f('Env Depth').id" label="Fine"/><Knob :id="f('Env Coarse Depth').id" label="Coarse"/></div></section>
    <section class="native-control-group"><h3>LFO Depth</h3><div class="control-knobs"><Knob :id="f('LFO Depth').id" label="Fine"/><Knob :id="f('Coarse LFO Depth').id" label="Coarse"/></div></section>
  </div>
  <div v-else class="application-controls node-depth-controls">
    <section><h3>Env →</h3><Knob :id="f(envField).id" :label="n.kind==='macro'?'Depth':'Level'" :disabled="scaled"/><ParamField :param="f('Env is Multiplicative')" label="" buttons/></section>
    <section><h3>LFO →</h3><div class="control-knobs"><Knob :id="f(lfoField).id" :label="n.kind==='mixer'?'Level':'Depth'"/><Knob v-if="n.kind==='mixer'" :id="f('LFO to Pan').id" label="Pan"/></div><ParamField :param="f(lfoMode)" label="" buttons/></section>
    <section v-if="n.kind==='matrix'||n.kind==='feedback'"><h3>OverDrv</h3><button class="overdrive-toggle" :aria-label="n.group+' Overdrive'" :aria-pressed="!!v('Overdrive')" :class="{chosen:!!v('Overdrive')}" @click="s.set(f('Overdrive').id,v('Overdrive')?0:1)">10x</button></section>
  </div>
</template>
