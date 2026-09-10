import { expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { SixSinesNode } from '../../web/six-sines-node.js'

test('raw MIDI encodes full channel messages, including two-byte pressure, and rejects malformed packets', async () => {
  const deliver = vi.fn().mockResolvedValue({})
  const receiver = {deliver} as unknown as SixSinesNode
  await SixSinesNode.prototype.midi1.call(receiver, [0x92,60,0])
  expect(deliver).toHaveBeenLastCalledWith([{type:7,port:0,paramId:0x3c92}])
  await SixSinesNode.prototype.midi1.call(receiver, [0xd2,90])
  expect(deliver).toHaveBeenLastCalledWith([{type:7,port:0,paramId:0x5ad2}])
  for (const bytes of [[0xf8],[0x90,60],[0x90,60,128],[]]) await expect(SixSinesNode.prototype.midi1.call(receiver, bytes)).rejects.toThrow()
})

test('worklet discards old performance queues only after successful preset replacement', () => {
  const source = readFileSync('../web/six-sines-worklet.js', 'utf8').replace(/^import .*;\n/m, '')
  let processor: {prototype: {onMessage: (message: unknown) => void}}
  runInNewContext(source, {AudioWorkletProcessor:class {}, registerProcessor: (_: string, cls: typeof processor) => {processor=cls}})
  const loadPreset = vi.fn(), postMessage = vi.fn()
  const instance = {ready:true, loadPreset, port:{postMessage}, immediateQueue:{head:4,count:9}, scheduledQueue:{head:2,count:3}}
  processor!.prototype.onMessage.call(instance, {type:'loadPreset',bytes:new Uint8Array([1]),requestId:3})
  expect(instance.immediateQueue).toEqual({head:0,count:0})
  expect(instance.scheduledQueue).toEqual({head:0,count:0})
  expect(postMessage).toHaveBeenLastCalledWith({type:'presetLoaded',requestId:3})
  instance.immediateQueue.count=1; loadPreset.mockImplementation(() => {throw new Error('bad preset')})
  processor!.prototype.onMessage.call(instance, {type:'loadPreset',bytes:new Uint8Array(),requestId:4})
  expect(instance.immediateQueue.count).toBe(1)
  expect(postMessage.mock.lastCall![0].type).toBe('error')
})
