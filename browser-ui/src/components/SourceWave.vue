<script setup lang="ts">
import { computed, inject } from 'vue'
import { editorKey, field } from '../model'
import tables from '../data/waveforms.json'
const props=defineProps<{extended?:boolean}>()
const s=inject(editorKey)!, n=s.selection
const v=(name:string)=>s.state.values[field(n.value,name)!.id]!
const wrap=(p:number)=>p-Math.floor(p)
function wave(id:number,p:number){const t=(tables as Record<string,number[]>)[id] ?? tables['0'];const x=wrap(p)*t.length,i=Math.floor(x);return t[i]!+(t[(i+1)%t.length]!-t[i]!)*(x-i)}
function remap(p:number,m:number,shape:number){
  p=wrap(p);m=Math.max(.03,Math.min(.97,m))
  const b=.5*(1-m), a=.25*(1-m)
  if(shape===0)return p<b?p/(2*b):.5+(p-b)/(2*(1-b))
  if(shape===1)return Math.min(p/(1-m),1-1e-8)
  if(shape===2)return p<m?.25:wrap(.25+(p-m)/(1-m))
  if(shape===3)return p<b?p/(1-m):p<.5?.5:p<1-.5*m?.5+(p-.5)/(1-m):1-1e-8
  if(shape===4)return p<.5*m?.25:p<.5?.25+(p-.5*m)/(1-m):p<.5+.5*m?.75:wrap(.75+(p-.5-.5*m)/(1-m))
  return p<a?p/(1-m):p<1-a?.25+(p-a)/(1+m):.75+(p-1+a)/(1-m)
}
function windowAt(p:number,shape:number){p=wrap(p);return shape===0?1-p:shape===1?1-Math.abs(2*p-1):shape===2?p<.5?1:2*(1-p):shape===3?p<.25?4*p:p<.75?1:4*(1-p):wave(shape===4?17:shape===5?18:20,p)}
const mode=computed(()=>props.extended?v('Extended Mode'):0)
const paths=computed(()=>{
  const out:number[]=[], window:number[]=[], mapping:number[]=[]
  let seed=0xdec0de42, smooth=0
  for(let i=0;i<256;i++){
    const t=i/255,p=wrap(t*(mode.value===2?2:1)+v('Phase')),m=v('Extended Mode M'),wf=v('Waveform')
    let y=wave(wf,p)
    if(mode.value===1){const r=remap(p,m,v('Phase Map Shape'));y=wave(wf,r);mapping.push(remap(t,m,v('Phase Map Shape'))*2-1)}
    if(mode.value===2){const w=windowAt(p,v('Resonant Sweep Window'));y=wave(wf,p*(1+m*([2,4,10][v('Sweep Depth')]??4)))*w;window.push(w)}
    // Noise is a stable illustration; the engine owns its random stream and filters.
    if(mode.value===3){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const white=(seed>>>0)/0xffffffff*2-1;smooth=.75*smooth+.25*white;const nt=v('Noise Type'),noise=nt===0?white:nt===3?(white>0?1:-1):smooth*(nt===2?1+v('Extended Mode N'):1);const nm=v('Noise Mode');y=nm===0?wave(wf,p+m*noise*.33):nm===1?y+m*noise:nm===2?(1-m)*y+m*noise:nm===3?y*(1+m*noise):(y+1)*(1+m*noise)-1}
    out.push(y)
  }
  const path=(values:number[])=>values.map((y,i)=>`${i?'L':'M'}${i/255*256},${48-Math.max(-1.2,Math.min(1.2,y))*44}`).join(' ')
  return {out:path(out),window:path(window),mapping:path(mapping)}
})
</script>
<template>
  <div class="wave-plots" :class="{mapped:mode===1}" :title="mode===3?'Noise illustration; random output varies':undefined">
    <svg v-if="mode===1" viewBox="0 0 256 96" preserveAspectRatio="none" role="img" aria-label="Phase mapping preview"><path d="M0 92L256 4" class="wave-grid"/><path :d="paths.mapping" class="wave-trace"/></svg>
    <svg viewBox="0 0 256 96" preserveAspectRatio="none" role="img" :aria-label="extended?'Extended waveform preview':'Oscillator waveform preview'">
      <path d="M0 48H256" class="wave-grid"/>
      <text v-if="v('Waveform')===21" x="128" y="52" text-anchor="middle" fill="currentColor" font-size="17">Audio In</text>
      <template v-else><path v-if="mode===2" :d="paths.window" class="wave-window"/><path :d="paths.out" class="wave-trace"/></template>
    </svg>
  </div>
</template>
