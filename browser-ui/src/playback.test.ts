// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { MidiInput } from './midi'
import { createEditorStore } from './model'
import init from './data/init.sxsnp?raw'

test('live edits and undo send parameter deltas; only preset loads replace the patch', () => {
  const parameters = vi.fn(), preset = vi.fn(), store = createEditorStore({parameters, preset})
  const original = store.state.values[500]
  store.set(500, .3)
  expect(parameters).toHaveBeenLastCalledWith([{id:500, value:Math.fround(.3)}])
  store.undo()
  expect(parameters).toHaveBeenLastCalledWith([{id:500, value:original}])
  store.redo()
  expect(parameters).toHaveBeenLastCalledWith([{id:500, value:Math.fround(.3)}])
  expect(preset).not.toHaveBeenCalled()
  store.loadPreset(init)
  expect(preset).toHaveBeenCalledTimes(1)
  expect(preset.mock.calls[0]![0]).toEqual(store.exportPreset())
})

test('MIDI selection, channel filtering and unplugging release notes without duplicate handlers', async () => {
  const port = (id: string) => ({id, name:id, state:'connected', onmidimessage:null, open:vi.fn().mockResolvedValue(undefined), close:vi.fn().mockResolvedValue(undefined)})
  const a = port('a'), b = port('b')
  const access = {inputs:new Map([['a', a], ['b', b]]), onstatechange:null}
  const request = vi.fn().mockResolvedValue(access)
  Object.defineProperty(navigator, 'requestMIDIAccess', {configurable:true, value:request})
  const receive = vi.fn(), panic = vi.fn(), changed = vi.fn()
  const midi = new MidiInput(receive, panic, changed)
  const send = (p: typeof a, data:number[]) => (p.onmidimessage as unknown as ((e:{data:Uint8Array})=>void))?.({data:new Uint8Array(data)})
  await midi.enable(); await midi.select('a')
  expect(request).toHaveBeenCalledWith({sysex:false})
  send(a,[0x90,60,100]); send(a,[0xb0,64,127]); send(a,[0x90,60,0]); send(a,[0xf8])
  expect(receive).toHaveBeenCalledTimes(3)
  midi.setChannel(1); send(a,[0x90,60,100]); send(a,[0x91,60,100])
  expect(receive).toHaveBeenCalledTimes(4)
  await midi.select('b')
  expect(a.close).toHaveBeenCalledOnce(); expect(a.onmidimessage).toBeNull()
  send(a,[0x91,60,100]); send(b,[0xd1,80])
  expect(receive).toHaveBeenCalledTimes(5)
  b.state='disconnected'
  ;(access.onstatechange as unknown as (()=>void))()
  expect(midi.selected).toBeUndefined(); expect(b.onmidimessage).toBeNull()
  expect(panic).toHaveBeenCalledTimes(4)
  midi.dispose(); expect(access.onstatechange).toBeNull()
})
