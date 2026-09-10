// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import { createApp, nextTick, type App, type Component } from 'vue'
import { createEditorStore, editorKey, field, node, parsePreset } from './model'
import Inspector from './components/Inspector.vue'
import PlaySettings from './components/PlaySettings.vue'
import MatrixMode from './components/MatrixMode.vue'
import waveforms from './data/waveforms.json'

let app: App | undefined
afterEach(()=>{app?.unmount();document.body.innerHTML=''})
function mount(component:Component=Inspector,kind='source',props={}){
  const store=createEditorStore();store.selection.value=node(kind)
  const root=document.createElement('div');document.body.append(root)
  app=createApp(component,props);app.provide(editorKey,store);app.mount(root)
  const param=(suffix:string)=>field(store.selection.value,suffix)!
  const control=(suffix:string)=>root.querySelector<HTMLElement>(`[aria-label="${param(suffix).name}"]`)
  const set=async(suffix:string,value:number)=>{store.set(param(suffix).id,value);await nextTick()}
  return {store,root,param,control,set}
}
test('native waveform samples contain a complete sine cycle',()=>{
  const sine=waveforms['0'];expect(sine).toHaveLength(512)
  expect(sine[0]).toBeCloseTo(0,4);expect(sine[128]).toBeCloseTo(1,4)
  expect(sine[256]).toBeCloseTo(0,4);expect(sine[384]).toBeCloseTo(-1,4)
})
test('source uses Extended Mode, with no generic parameter dump or duplicate controls',async()=>{
  const {root,control,set}=mount()
  expect(root.textContent).not.toContain('More source settings')
  expect(control('Extended Mode')).not.toBeNull();expect(control('Extended Mode M')).toBeNull()
  expect(control('Env to Ratio (Fine)')).not.toBeNull()
  await set('Extended Mode',1)
  expect(control('Phase Map Shape')).not.toBeNull();expect(control('Extended Mode M')).not.toBeNull()
  expect(control('Extended Mode N')).toBeNull();expect(control('Resonant Sweep Window')).toBeNull()
  await set('Extended Mode',2)
  expect(control('Phase Map Shape')).toBeNull();expect(control('Resonant Sweep Window')).not.toBeNull()
  expect(control('Sweep Depth')).not.toBeNull();expect(control('Extended Mode N')).toBeNull()
  const controls=[...root.querySelectorAll('input[aria-label],select[aria-label],[role=slider][aria-label]')].map(e=>e.getAttribute('aria-label'))
  expect(new Set(controls).size).toBe(controls.length)
})
test('Noise type determines N availability and LFSR visibility',async()=>{
  const {control,set}=mount();await set('Extended Mode',3)
  await set('Noise Type',1)
  expect(control('Extended Mode N')?.getAttribute('aria-disabled')).toBe('true')
  expect(control('LFSR Mode')).toBeNull()
  await set('Noise Type',2)
  expect(control('Extended Mode N')?.getAttribute('aria-disabled')).toBeNull()
  await set('Noise Type',3);expect(control('LFSR Mode')).not.toBeNull()
})
test('source target choices track the active Extend Mode and retain inactive values',async()=>{
  const {root,store,param,set}=mount();const target=root.querySelector<HTMLSelectElement>('[aria-label="Modulation target 1"]')!
  const option=(id:number)=>target.querySelector<HTMLOptionElement>(`option[value="${id}"]`)!
  expect(option(18).disabled).toBe(true);expect(option(19).disabled).toBe(true)
  await set('Extended Mode',1);expect(option(18).disabled).toBe(false);expect(option(19).disabled).toBe(true)
  await set('Extended Mode',3);expect(option(19).disabled).toBe(false)
  store.set(store.selection.value.modTarget[0]!,19);await set('Extended Mode',0)
  expect(store.state.values[store.selection.value.modTarget[0]!]).toBe(19)
  expect(param('Extended Mode').id).toBe(1675)
})
test('source pitch and Audio In follow native enabling rules',async()=>{
  const {control,set,root}=mount()
  expect((control('Absolute Frequency at Ratio=1') as HTMLInputElement).disabled).toBe(true)
  await set('Keytrack',0);expect((control('Absolute Frequency at Ratio=1') as HTMLInputElement).disabled).toBe(false)
  expect((control('Octave Transpose') as HTMLInputElement).disabled).toBe(true)
  await set('Keytrack Frequency is Low Frequency',1)
  expect(control('Absolute Frequency at Ratio=1')).toBeNull();expect(control('Keytrack Frequency at Ratio=1 (Low Frequency)')).not.toBeNull()
  await set('Waveform',21)
  expect((control('Extended Mode') as HTMLSelectElement).disabled).toBe(true)
  expect(root.querySelector('.modulator-pair')?.hasAttribute('inert')).toBe(true)
})
test('step count limits editable rows, and trigger settings respect native restrictions',async()=>{
  const {root,control,set}=mount(Inspector,'main')
  await set('LFO Shape',7);await set('Step Count',4)
  expect(root.querySelectorAll('.sequence-grid input')).toHaveLength(4)
  expect((control('Bipolar') as HTMLButtonElement).disabled).toBe(true)
  ;(root.querySelector('[aria-label="Envelope trigger settings"]') as HTMLButtonElement).click();await nextTick()
  const triggers=control('Env Trigger Mode') as HTMLSelectElement
  expect(triggers.querySelector<HTMLOptionElement>('option[value="1"]')!.disabled).toBe(true)
  expect(triggers.querySelector<HTMLOptionElement>('option[value="4"]')!.disabled).toBe(true)
})
test('mixer, tuning, and panning expose correctly grouped depths',async()=>{
  const {store,control,root}=mount(Inspector,'mixer')
  expect(control('LFO to Pan')).not.toBeNull()
  expect(control('EnvToLevel')?.getAttribute('aria-disabled')).toBe('true')
  store.selection.value=node('tune');await nextTick()
  for(const suffix of ['Env Depth','Env Coarse Depth','LFO Depth','Coarse LFO Depth','Coarse Tuning'])expect(control(suffix)).not.toBeNull()
  store.selection.value=node('pan');await nextTick()
  expect(control('LFO Depth')).not.toBeNull();expect(root.textContent).not.toContain('Level')
})
test('settings exclude hidden/obsolete fields, gate dependent controls, and store key trigger as 2',async()=>{
  const {root,store}=mount(PlaySettings,'main')
  expect(root.textContent).not.toContain('Unused');expect(root.textContent).not.toContain('Seq Step')
  const porta=root.querySelector<HTMLInputElement>('[aria-label="Main Portamento Time"]')!
  expect(porta.disabled).toBe(true);store.set(523,1);await nextTick();expect(porta.disabled).toBe(false)
  const trigger=root.querySelector<HTMLSelectElement>('[aria-label="Main Default Env Mode"]')!
  trigger.value='2';trigger.dispatchEvent(new Event('change'));await nextTick()
  expect(parsePreset(new TextDecoder().decode(store.exportPreset())).values[527]).toBe(2)
})
test('matrix mode popup groups RM rescaling and enables it only for RM',async()=>{
  const route=node('matrix',14),{root,store}=mount(MatrixMode,'matrix',{node:route})
  const rm=[...root.querySelectorAll<HTMLButtonElement>('button')].filter(b=>b.textContent?.startsWith('RM by'))
  expect(rm).toHaveLength(3);expect(rm.every(b=>b.disabled)).toBe(true)
  store.set(field(route,'modulation mode')!.id,1);await nextTick()
  expect(rm.every(b=>!b.disabled)).toBe(true);rm[2]!.click()
  expect(store.state.values[field(route,'RM Rescaling')!.id]).toBe(2)
})
