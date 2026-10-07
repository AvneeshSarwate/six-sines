// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createEditorStore, field, node, parsePreset, serializePreset } from './model'
import init from './data/init.sxsnp?raw'
import {
  attachWavetable,
  AUDIO_IN,
  decodeBlob,
  defaultWavetable,
  detachWavetable,
  encodeBlob,
  parseWavetable,
  sampleWavetable,
  USER_TABLE,
  wavetableFor,
} from './wavetable'

/** A Surge .wt: float32 frames, sine then square. */
function surgeTable(frames = 4, samples = 256) {
  const bytes = new Uint8Array(12 + frames * samples * 4),
    view = new DataView(bytes.buffer)
  bytes.set([...'vawt'].map((c) => c.charCodeAt(0)))
  view.setUint32(4, samples, true)
  view.setUint16(8, frames, true)
  view.setUint16(10, 0, true)
  for (let f = 0; f < frames; f++)
    for (let i = 0; i < samples; i++) {
      const sine = Math.sin((2 * Math.PI * i) / samples),
        square = i < samples / 2 ? 0.9 : -0.9
      const t = f / (frames - 1)
      view.setFloat32(12 + 4 * (f * samples + i), (1 - t) * sine + t * square, true)
    }
  return bytes
}

/** A 16-bit Serum-style WAVE with a clm chunk declaring 512 sample frames. */
function serumWav(frames = 3, samples = 512) {
  const clm = new TextEncoder().encode('<!>512 10000000')
  const data = frames * samples * 2,
    size = 12 + 24 + 8 + clm.length + 8 + data
  const bytes = new Uint8Array(size + (clm.length & 1)),
    view = new DataView(bytes.buffer)
  let at = 0
  const tag = (t: string) => (
    bytes.set(
      [...t].map((c) => c.charCodeAt(0)),
      at,
    ),
    (at += 4)
  )
  const u32 = (v: number) => (view.setUint32(at, v, true), (at += 4))
  const u16 = (v: number) => (view.setUint16(at, v, true), (at += 2))
  ;(tag('RIFF'), u32(size - 8), tag('WAVE'))
  ;(tag('fmt '), u32(16), u16(1), u16(1), u32(48000), u32(96000), u16(2), u16(16))
  ;(tag('clm '), u32(clm.length), bytes.set(clm, at), (at += clm.length + (clm.length & 1)))
  ;(tag('data'), u32(data))
  for (let i = 0; i < frames * samples; i++) u16((Math.round(Math.sin(i) * 1000) + 65536) & 0xffff)
  return bytes
}

describe('wavetable files', () => {
  test('Surge .wt and Serum WAVE frames parse the way the native loader slices them', () => {
    const wt = parseWavetable(surgeTable())
    expect(wt.error).toBeUndefined()
    expect(wt.frames).toHaveLength(4)
    expect(wt.frames[0]![64]).toBeCloseTo(1, 5)
    expect(sampleWavetable(wt.frames, 1, 0.25)).toBeCloseTo(0.9, 5)
    const wav = parseWavetable(serumWav())
    expect(wav.error).toBeUndefined()
    expect(wav.frames.map((f) => f.length)).toEqual([512, 512, 512])
    expect(parseWavetable(new Uint8Array([1, 2, 3, 4, 5])).error).toBe(
      'that file is not a Surge .wt or a WAVE file',
    )
  })

  test('the built-in table runs from a sine to a ten harmonic saw', () => {
    const frames = defaultWavetable()
    expect(frames).toHaveLength(10)
    expect(sampleWavetable(frames, 0, 0.25)).toBeCloseTo(0.99, 3)
  })

  test('blobs use zlib deflate + base64 and dedupe by content', async () => {
    const bytes = surgeTable()
    expect(await decodeBlob(await encodeBlob(bytes))).toEqual(bytes)
    let xml = await attachWavetable(init, 2, bytes, 'Sine Square')
    xml = await attachWavetable(xml, 4, bytes, 'Again')
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.querySelectorAll('wavetables > table')).toHaveLength(1)
    const table = doc.querySelector('wavetables > table')!
    expect(table.getAttribute('raw')).toBe(String(bytes.length))
    expect(table.getAttribute('encoding')).toBe('deflate-base64')
    expect(wavetableFor(xml, 4)?.name).toBe('Sine Square')
    expect(wavetableFor(detachWavetable(xml, 4), 4)).toBeUndefined()
    expect(wavetableFor(detachWavetable(xml, 4), 2)?.name).toBe('Sine Square')
  })
})

describe('editor store', () => {
  test('loading a table is one undoable preset change; undo reloads the preset', async () => {
    const presets: string[] = [],
      parameters: unknown[] = []
    const s = createEditorStore({
      preset: (b) => presets.push(new TextDecoder().decode(b)),
      parameters: (c) => parameters.push(c),
    })
    const wf = field(node('source', 1), 'Waveform')!.id
    expect(await s.loadWavetable(1, surgeTable(), 'Sine Square')).toBe(true)
    expect(s.state.values[wf]).toBe(USER_TABLE)
    expect(presets).toHaveLength(1)
    expect(wavetableFor(presets[0]!, 1)?.name).toBe('Sine Square')
    expect(parsePreset(presets[0]!).values[wf]).toBe(USER_TABLE)
    s.undo()
    expect(s.state.values[wf]).toBe(0)
    expect(presets).toHaveLength(2)
    expect(wavetableFor(presets[1]!, 1)).toBeUndefined()
    expect(parameters).toHaveLength(0)

    expect(await s.loadWavetable(1, new Uint8Array([9, 9, 9, 9]), 'junk')).toBe(false)
    expect(s.error.value).toMatch(/not a Surge .wt or a WAVE/)
    expect(presets).toHaveLength(2)
  })

  test('pre-13 Audio In moves to 22 and pre-14 patches keep the 1.2 DSP', () => {
    const old = init
      .replace(/version="\d+"/, 'version="12"')
      .replace(/<p id="1505" v="[^"]*"/, '<p id="1505" v="21"')
      .replace(/<p id="559" v="[^"]*" \/>/, '')
    const state = parsePreset(old)
    expect(state.values[1505]).toBe(AUDIO_IN)
    expect(state.values[559]).toBe(1)
    const saved = serializePreset(state)
    expect(saved).toMatch(/version="14"/)
    expect(parsePreset(saved).values[1505]).toBe(AUDIO_IN)
    expect(parsePreset(init).values[559]).toBe(0)
  })
})

const engine = resolve(
  process.env.SIX_SINES_WASM ?? resolve(__dirname, '../../build/browser-port/web/six-sines.js'),
)
// Rendered in a child Node: the engine is an Emscripten build artifact outside Vite's graph.
const renderScript = `
import { readFileSync } from 'node:fs'
const [enginePath, ...presets] = process.argv.slice(1)
const { default: create } = await import(enginePath)
const wasm = await create()
const eventSize = wasm._sx_event_sizeof(), frames = 8192
const out = presets.map((path) => {
  const bytes = readFileSync(path), handle = wasm._sx_create(48000)
  const preset = wasm._malloc(bytes.length), event = wasm._malloc(eventSize)
  const left = wasm._malloc(frames * 4), right = wasm._malloc(frames * 4)
  wasm.HEAPU8.set(bytes, preset)
  if (wasm._sx_load_preset_utf8(handle, preset, bytes.length) !== 1) throw new Error('load ' + path)
  wasm.HEAPU8.fill(0, event, event + eventSize)
  const view = new DataView(wasm.HEAPU8.buffer, event, eventSize)
  view.setUint32(4, 1, true); view.setInt32(8, 1, true); view.setInt16(16, 60, true)
  view.setFloat64(32, 0.8, true)
  if (wasm._sx_process(handle, frames, 0, 0, left, right, event, 1) !== 1) throw new Error('process')
  return Array.from(new Float32Array(wasm.HEAPF32.buffer, left, frames))
})
process.stdout.write(JSON.stringify(out))
`
describe.skipIf(!existsSync(engine))('wasm engine', () => {
  test('plays a table the editor embedded', async () => {
    const withValues = (xml: string, values: Record<number, number>) => {
      const state = parsePreset(xml)
      Object.assign(state.values, values)
      return serializePreset(state)
    }
    const morphed = { 1505: USER_TABLE, 1689: 1 }
    const dir = mkdtempSync(join(tmpdir(), 'six-sines-wt-'))
    const files = [
      withValues(await attachWavetable(init, 0, surgeTable(), 'sq'), morphed),
      withValues(init, morphed),
      init,
    ].map((xml, i) => {
      const path = join(dir, `${i}.sxsnp`)
      writeFileSync(path, xml)
      return path
    })
    const [embedded, builtIn, sine] = JSON.parse(
      execFileSync(process.execPath, [
        '--input-type=module',
        '-e',
        renderScript,
        pathToFileURL(engine).href,
        ...files,
      ]).toString(),
    ) as number[][]
    const frames = embedded!.length
    const diff = (a: number[], b: number[]) =>
      a.slice(frames / 2).reduce((sum, v, i) => sum + Math.abs(v - b[i + frames / 2]!), 0) /
      (frames / 2)
    expect(Math.max(...embedded!.map(Math.abs))).toBeGreaterThan(1e-3)
    expect(diff(embedded!, sine!)).toBeGreaterThan(1e-3)
    expect(diff(embedded!, builtIn!)).toBeGreaterThan(1e-3)
  }, 60000)
})
