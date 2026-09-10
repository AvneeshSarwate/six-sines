<script setup lang="ts">
import { inject, ref } from 'vue'
import { editorKey, field, type Node } from '../model'
const props=defineProps<{node:Node}>()
const s=inject(editorKey)!, menu=ref<HTMLDetailsElement>()
const mode=()=>field(props.node,'modulation mode')!
const scale=()=>field(props.node,'RM Rescaling')!
function choose(id:number,value:number){s.set(id,value);menu.value!.open=false}
</script>
<template>
 <details ref="menu" class="matrix-mode-menu" @toggle="menu?.open && (s.selection.value=node)">
  <summary class="mode-mini" :aria-label="node.group+' mode'">{{['PM','RM','Lin','Exp'][s.state.values[mode().id]!]}}</summary>
  <div class="popover" role="menu" :aria-label="node.group+' modulation mode'">
   <button v-for="o in mode().options" :key="o.value" role="menuitemradio" :aria-checked="s.state.values[mode().id]===o.value" :class="{chosen:s.state.values[mode().id]===o.value}" @click="choose(mode().id,o.value)">{{o.label}}</button>
   <hr/>
   <button v-for="o in scale().options" :key="o.value" role="menuitemradio" :disabled="s.state.values[mode().id]!==1" :aria-checked="s.state.values[mode().id]===1&&s.state.values[scale().id]===o.value" @click="choose(scale().id,o.value)">RM by {{o.label}}</button>
  </div>
 </details>
</template>
