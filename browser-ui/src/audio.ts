import { onBeforeUnmount, ref, watch } from 'vue'
import type { SixSinesNode } from '../../web/six-sines-node.js'
import type { ParameterChange } from './model'

export function useAudio(preset: () => Uint8Array) {
  const status = ref('Off'),
    error = ref(''),
    muted = ref(false),
    volume = ref(0),
    peak = ref(0),
    detail = ref('')
  let context: AudioContext | undefined,
    engine: SixSinesNode | undefined,
    gain: GainNode | undefined
  let meter: ReturnType<typeof setInterval> | undefined
  let commands = Promise.resolve()
  const enqueue = (run: (node: SixSinesNode) => Promise<unknown>) => {
    const node = engine
    if (node)
      commands = commands
        .then(() => run(node))
        .then(() => {})
        .catch(report)
  }
  const pending = new Map<number, number>()
  let frame = 0
  const report = (e: unknown) => {
    error.value = String(e)
  }
  function parameters(changes: ParameterChange[]) {
    if (!engine) return
    for (const p of changes) pending.set(p.id, p.value)
    if (!frame) frame = requestAnimationFrame(flush)
  }
  function flush() {
    cancelAnimationFrame(frame)
    frame = 0
    if (pending.size && engine) {
      const events = Array.from(pending, ([paramId, value]) => ({ type: 4, paramId, value }))
      enqueue((node) => node.send(events))
    }
    pending.clear()
  }
  function midi(data: ArrayLike<number>) {
    if (!engine || status.value !== 'Running' || data[0]! < 0x80 || data[0]! >= 0xf0) return
    flush()
    const bytes = Uint8Array.from(data)
    enqueue((node) => node.midi1(bytes))
  }
  function panic() {
    if (!engine) return
    enqueue((node) =>
      node.send([
        ...Array.from({ length: 16 }, (_, channel) => ({
          type: 7,
          paramId: 0xb0 | channel | (64 << 8),
        })),
        { type: 6 },
      ]),
    )
  }
  function load(bytes: Uint8Array) {
    pending.clear()
    cancelAnimationFrame(frame)
    frame = 0
    if (engine) {
      enqueue((node) => node.loadPreset(bytes))
      panic()
    }
  }
  function updateGain() {
    if (gain && context)
      gain.gain.setTargetAtTime(
        muted.value ? 0 : 10 ** (volume.value / 20),
        context.currentTime,
        0.005,
      )
  }
  watch([muted, volume], updateGain)
  async function start() {
    if (status.value === 'Starting') return
    error.value = ''
    try {
      if (context && engine) {
        await context.resume()
        status.value = 'Running'
        return
      }
      status.value = 'Starting'
      context = new AudioContext({ latencyHint: 'interactive' })
      const resumed = context.resume()
      const base = new URL(import.meta.env.BASE_URL + 'engine/', document.baseURI)
      const module = (await import(
        /* @vite-ignore */ new URL('six-sines-node.js', base).href
      )) as typeof import('../../web/six-sines-node.js')
      await resumed
      engine = await module.SixSinesNode.create(context, {
        workletUrl: new URL('six-sines-worklet.js', base),
        wasmUrl: new URL('six-sines.wasm', base),
        presetBytes: preset(),
      })
      // Include edits made while the engine was starting.
      await engine.loadPreset(preset())
      gain = context.createGain()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      engine.connect(gain)
      gain.connect(analyser)
      analyser.connect(context.destination)
      updateGain()
      const samples = new Float32Array(analyser.fftSize)
      meter = setInterval(() => {
        if (engine?.lastError) report(engine.lastError)
        analyser.getFloatTimeDomainData(samples)
        peak.value = samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0)
      }, 100)
      detail.value = `${context.sampleRate / 1000} kHz · ${engine.readyInfo.buildId}`
      status.value = 'Running'
      context.onstatechange = () => {
        status.value = context?.state === 'running' ? 'Running' : 'Paused'
      }
    } catch (e) {
      report(e)
      engine?.disconnect()
      engine = undefined
      await context?.close()
      context = undefined
      status.value = 'Off'
    }
  }
  onBeforeUnmount(() => {
    panic()
    cancelAnimationFrame(frame)
    clearInterval(meter)
    void engine?.dispose().catch(() => {})
    void context?.close()
  })
  return { status, error, muted, volume, peak, detail, start, parameters, load, midi, panic }
}
