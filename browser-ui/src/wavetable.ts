/*
 * User wavetables in the browser editor.
 *
 * The engine owns the sound: it rebuilds every table from the source bytes a preset carries.
 * This module only needs those bytes in the native patch format (deflate + base64 inside
 * <wavetables>, operator references in <sourceWavetables>) and enough of a parse to draw the
 * frames and gate morph. Parsing mirrors src/dsp/wavetable_io.cpp so a file the engine
 * rejects is rejected here with the same reason instead of silently falling back to a sine.
 */

export const USER_TABLE = 21
export const AUDIO_IN = 22
export const DEFAULT_TABLE_NAME = 'Sine to Saw'
const maxSourceFrames = 512

export interface ParsedWavetable {
  frames: Float32Array[]
  error?: string
}

const fail = (error: string): ParsedWavetable => ({ frames: [], error })
const tag = (b: Uint8Array, at: number, t: string) =>
  at + 4 <= b.length && String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!) === t

function slice(mono: Float32Array, cycle: number): ParsedWavetable {
  if (cycle < 2) return fail('wavetable frame size is too small')
  const n = Math.floor(mono.length / cycle)
  if (n === 0) return fail(`wavetable has no complete frame of ${cycle} samples`)
  if (n > maxSourceFrames)
    return fail(`wavetable declares ${n} frames, more than the ${maxSourceFrames} supported`)
  return { frames: Array.from({ length: n }, (_, i) => mono.slice(i * cycle, (i + 1) * cycle)) }
}

function parseSurgeWT(b: Uint8Array): ParsedWavetable {
  if (b.length < 12 || !tag(b, 0, 'vawt')) return fail('not a Surge wavetable')
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const nSamples = view.getUint32(4, true),
    nTables = view.getUint16(8, true),
    flags = view.getUint16(10, true)
  if (flags & 1) return fail('that .wt holds a sample, not a wavetable')
  if (nSamples < 2 || nTables === 0) return fail('Surge wavetable declares no content')
  if (nTables > maxSourceFrames)
    return fail(
      `Surge wavetable declares ${nTables} frames, more than the ${maxSourceFrames} supported`,
    )
  const int16 = !!(flags & 4),
    bytesPer = int16 ? 2 : 4,
    need = nSamples * nTables * bytesPer
  if (b.length - 12 < need)
    return fail(
      `Surge wavetable is truncated: wanted ${need} bytes of samples, found ${b.length - 12}`,
    )
  const scale = flags & 8 ? 1 / 32768 : 1 / 16384
  const mono = new Float32Array(nSamples * nTables)
  for (let i = 0; i < mono.length; i++)
    mono[i] = int16 ? view.getInt16(12 + 2 * i, true) * scale : view.getFloat32(12 + 4 * i, true)
  return slice(mono, nSamples)
}

function parseWav(b: Uint8Array): ParsedWavetable {
  if (b.length < 12 || !tag(b, 0, 'RIFF') || !tag(b, 8, 'WAVE')) return fail('not a RIFF WAVE file')
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let format = 0,
    channels = 0,
    bits = 0,
    data = -1,
    dataBytes = 0,
    clm = 0,
    cue = 0,
    srge = 0,
    smpl = 0
  // Frame size hints in Surge's priority order: clm / uhWT, cue, srge, smpl.
  for (let p = 12; b.length - p >= 8;) {
    const q = p + 8
    let cs = view.getUint32(p + 4, true)
    if (b.length - q < cs) cs = b.length - q
    if (tag(b, p, 'fmt ') && cs >= 16) {
      format = view.getUint16(q, true)
      channels = view.getUint16(q + 2, true)
      bits = view.getUint16(q + 14, true)
    } else if (tag(b, p, 'data')) {
      data = q
      dataBytes = cs
    } else if (tag(b, p, 'clm ') && cs >= 4) {
      const s = new TextDecoder('latin1').decode(b.subarray(q, q + Math.min(cs, 32)))
      const at = s.indexOf('<!>')
      if (at >= 0) {
        const n = Number.parseInt(s.slice(at + 3), 10)
        if (n >= 2 && n <= 65536) clm = n
      }
    } else if (tag(b, p, 'uhWT')) clm = 2048
    else if ((tag(b, p, 'srge') || tag(b, p, 'srgo')) && cs >= 8) {
      const n = view.getUint32(q + 4, true)
      if (n >= 2 && n <= 65536) srge = n
    } else if (tag(b, p, 'cue ') && cs >= 4) {
      const n = Math.min(view.getUint32(q, true), Math.floor((cs - 4) / 24))
      if (n >= 2) {
        const pos = (i: number) => view.getUint32(q + 4 + i * 24 + 20, true)
        const d = pos(1) > pos(0) ? pos(1) - pos(0) : 0
        if (d >= 2 && d <= 65536) cue = d
      }
    } else if (tag(b, p, 'smpl')) smpl = 2048
    p = q + cs + (cs & 1)
  }
  if (data < 0 || dataBytes === 0) return fail('WAVE file has no data chunk')
  if (format !== 1 && format !== 3) return fail(`unsupported WAVE encoding ${format}`)
  if (channels === 0 || bits === 0 || bits % 8) return fail('WAVE file has no usable format chunk')
  const bytesPer = bits / 8,
    stride = bytesPer * channels,
    n = Math.floor(dataBytes / stride)
  if (n < 2) return fail('WAVE file is too short')
  const mono = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const at = data + i * stride
    mono[i] =
      format === 3
        ? bits === 64
          ? view.getFloat64(at, true)
          : view.getFloat32(at, true)
        : bits === 8
          ? (b[at]! - 128) / 128
          : bits === 16
            ? view.getInt16(at, true) / 32768
            : bits === 24
              ? ((b[at]! << 8) | (b[at + 1]! << 16) | (b[at + 2]! << 24)) / 2147483648
              : bits === 32
                ? view.getInt32(at, true) / 2147483648
                : 0
  }
  let cycle = clm || cue || srge || smpl
  if (!cycle) cycle = [2048, 4096, 1024, 512, 256, 128].find((c) => n % c === 0) ?? 0
  if (!cycle)
    return fail(
      'cannot tell the frame size of that WAVE file; no clm, cue, srge or smpl chunk and its length is not a multiple of a common frame size',
    )
  if (n < cycle) return fail('WAVE file is shorter than the frame size it declares')
  return slice(mono, cycle)
}

export function parseWavetable(bytes: Uint8Array): ParsedWavetable {
  if (bytes.length < 4) return fail('that file is empty or too short to be a wavetable')
  if (tag(bytes, 0, 'vawt')) return parseSurgeWT(bytes)
  if (tag(bytes, 0, 'RIFF')) return parseWav(bytes)
  return fail('that file is not a Surge .wt or a WAVE file')
}

let defaultFrames: Float32Array[] | undefined
/** The engine's built-in table: frame t is the saw series truncated to t + 1 harmonics. */
export function defaultWavetable(): Float32Array[] {
  return (defaultFrames ??= Array.from({ length: 10 }, (_, t) => {
    const f = new Float32Array(2048)
    let peak = 0
    for (let i = 0; i < f.length; i++) {
      for (let n = 1; n <= t + 1; n++) f[i]! += Math.sin((2 * Math.PI * n * i) / f.length) / n
      peak = Math.max(peak, Math.abs(f[i]!))
    }
    return f.map((v) => (v * 0.99) / peak)
  }))
}

/** One sample of the table at phase p in [0, 1) and morph in [0, 1], for drawing. */
export function sampleWavetable(frames: Float32Array[], morph: number, p: number) {
  const at = (frame: Float32Array) => {
    const x = (p - Math.floor(p)) * frame.length,
      i = Math.floor(x)
    return frame[i]! + (frame[(i + 1) % frame.length]! - frame[i]!) * (x - i)
  }
  const pos = Math.min(1, Math.max(0, morph)) * (frames.length - 1),
    lo = Math.min(Math.floor(pos), frames.length - 1),
    hi = Math.min(lo + 1, frames.length - 1)
  return at(frames[lo]!) * (1 - (pos - lo)) + at(frames[hi]!) * (pos - lo)
}

/** fnv-1a, matching the native dedup key; written as hex the way the native patch does. */
export function hashBytes(bytes: Uint8Array): string {
  let h = 0xcbf29ce484222325n
  for (const b of bytes) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n)
  return h.toString(16)
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const writer = stream.writable.getWriter()
  void writer.write(bytes as Uint8Array<ArrayBuffer>).then(
    () => writer.close(),
    () => {},
  )
  const chunks: Uint8Array[] = [],
    reader = stream.readable.getReader()
  for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value)
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  chunks.reduce((at, c) => (out.set(c, at), at + c.length), 0)
  return out
}

function toBase64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** zlib deflate + base64, as miniz compress2 writes it into <table encoding="deflate-base64">. */
export const encodeBlob = async (bytes: Uint8Array) =>
  toBase64(await pipe(bytes, new CompressionStream('deflate')))

export async function decodeBlob(text: string): Promise<Uint8Array> {
  const raw = Uint8Array.from(atob(text.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  return pipe(raw, new DecompressionStream('deflate'))
}

export interface WavetableRef {
  name: string
  hash: string
  /** base64 payload, used as the cache key for decoded frames */
  payload: string
}

/** The table operator `op` references in a native preset, or undefined for none. */
export function wavetableFor(xml: string, op: number): WavetableRef | undefined {
  const doc = new DOMParser().parseFromString(xml, 'application/xml'),
    root = doc.documentElement
  const source = root.querySelector(`:scope > sourceWavetables > source[idx="${op}"]`)
  if (!source) return undefined
  const table = root.querySelector(
    `:scope > wavetables > table[idx="${source.getAttribute('table')}"]`,
  )
  if (!table) return undefined
  return {
    name: table.getAttribute('name') ?? '',
    hash: table.getAttribute('hash') ?? '',
    payload: table.textContent ?? '',
  }
}

/**
 * Add `bytes` to the preset's tables (deduplicated by content, as Patch::addWavetableBlob
 * does) and point operator `op` at them. Returns the new XML.
 */
export async function attachWavetable(xml: string, op: number, bytes: Uint8Array, name: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml'),
    root = doc.documentElement
  const child = (name: string) => {
    let el = root.querySelector(`:scope > ${name}`)
    if (!el) root.appendChild((el = doc.createElement(name)))
    return el
  }
  const tables = child('wavetables'),
    sources = child('sourceWavetables')
  const hash = hashBytes(bytes)
  let idx = Array.from(tables.children)
    .find((t) => t.getAttribute('hash') === hash)
    ?.getAttribute('idx')
  if (idx == null) {
    idx = String(
      Array.from(tables.children).reduce((m, t) => Math.max(m, Number(t.getAttribute('idx'))), -1) +
        1,
    )
    const table = doc.createElement('table')
    table.setAttribute('idx', idx)
    table.setAttribute('raw', String(bytes.length))
    table.setAttribute('encoding', 'deflate-base64')
    table.setAttribute('name', name)
    table.setAttribute('hash', hash)
    table.textContent = await encodeBlob(bytes)
    tables.appendChild(table)
  }
  let source = sources.querySelector(`source[idx="${op}"]`)
  if (!source) {
    source = doc.createElement('source')
    source.setAttribute('idx', String(op))
    sources.appendChild(source)
  }
  source.setAttribute('table', idx)
  return new XMLSerializer().serializeToString(doc)
}

/** Drop operator `op`'s reference. The blob stays, as native Clear Wavetable leaves it. */
export function detachWavetable(xml: string, op: number) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  doc.documentElement.querySelector(`:scope > sourceWavetables > source[idx="${op}"]`)?.remove()
  return new XMLSerializer().serializeToString(doc)
}
