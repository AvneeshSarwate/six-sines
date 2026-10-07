import { computed, reactive, type Ref } from 'vue'
import { field, type EditorStore, type Node } from './model'
import {
  decodeBlob,
  DEFAULT_TABLE_NAME,
  defaultWavetable,
  parseWavetable,
  USER_TABLE,
  wavetableFor,
  type ParsedWavetable,
} from './wavetable'

export interface OperatorTable {
  name: string
  frames: Float32Array[]
  builtIn: boolean
  error?: string
}

// Decoded frames by payload; decoding is async (DecompressionStream) so entries fill in later.
const decoded = reactive(new Map<string, ParsedWavetable>())
const inflight = new Set<string>()

function decode(payload: string) {
  if (inflight.has(payload)) return
  inflight.add(payload)
  decodeBlob(payload)
    .then((bytes) => parseWavetable(bytes))
    .catch(() => ({ frames: [], error: 'the wavetable stored in this patch could not be read' }))
    .then((parsed) => decoded.set(payload, parsed))
}

/** The table the selected operator plays, as the native waveform painter resolves it. */
export function useOperatorTable(s: EditorStore, n: Ref<Node>) {
  return computed<OperatorTable | undefined>(() => {
    if (n.value.kind !== 'source') return undefined
    if (s.state.values[field(n.value, 'Waveform')!.id] !== USER_TABLE) return undefined
    const ref = wavetableFor(s.state.xml, n.value.index)
    if (!ref) return { name: DEFAULT_TABLE_NAME, frames: defaultWavetable(), builtIn: true }
    const hit = decoded.get(ref.payload)
    if (!hit) decode(ref.payload)
    return { name: ref.name, frames: hit?.frames ?? [], builtIn: false, error: hit?.error }
  })
}
