import { computed, reactive, ref, type InjectionKey } from 'vue'
import rawSchema from './data/schema.json'
import initXml from './data/init.sxsnp?raw'
export interface Choice {
  value: number
  label: string
  group?: string
}
export interface Parameter {
  id: number
  name: string
  group: string
  type: number
  min: number
  max: number
  default: number
  scale: number
  unit: string
  digits: number
  a: number
  b: number
  c: number
  d: number
  options: Choice[]
}
export interface Node {
  kind: string
  index: number
  group: string
  params: number[]
  targets: Choice[]
  modSource: number[]
  modTarget: number[]
  modDepth: number[]
}
export const schema = rawSchema as { params: Parameter[]; nodes: Node[]; sources: Choice[] }
export const byId = new Map(schema.params.map((p) => [p.id, p]))
export const node = (kind: string, index = 0) =>
  schema.nodes.find((n) => n.kind === kind && n.index === index)!
export const parameters = (n: Node) => n.params.map((id) => byId.get(id)!).filter(Boolean)
export const field = (n: Node, suffix: string) =>
  parameters(n).find((p) => p.name === `${n.group} ${suffix}`)
export const shortName = (p: Parameter) =>
  p.name.startsWith(p.group + ' ') ? p.name.slice(p.group.length + 1) : p.name
export function display(p: Parameter, value: number): string {
  if (p.id === 527) return value === 2 ? 'On Any Key Press' : 'On Start or In Release (Legato)'
  if (p.name.endsWith('Env Trigger Mode'))
    return (
      ['Legato', 'Voice start', 'Any key press', 'Patch default', 'On release'][
        Math.round(value)
      ] ?? String(value)
    )
  const option = p.options.find((o) => o.value === Math.round(value))
  if (option) return option.label
  let v = value
  if (p.scale === 0) v = p.a * value + p.b
  else if (p.scale === 1) v = p.a * 2 ** (p.b * value + p.c) + p.d
  else if (p.scale === 2) return value <= 0 ? '−∞ dB' : `${(60 * Math.log10(value)).toFixed(1)} dB`
  else if (p.scale === 3) v = (Math.exp(p.a + value * (p.b - p.a)) + p.c) / p.d
  if (!Number.isFinite(v)) return String(value)
  if (p.unit === 's' && v < 1) return `${(v * 1000).toFixed(1)} ms`
  return `${v.toFixed(Math.min(p.digits, 4))}${p.unit ? ' ' + p.unit : ''}`
}
export function readDisplay(p: Parameter, text: string): number {
  const f = text.trim().match(/^(-?[\d.]+)\s*\/\s*([\d.]+)$/)
  let v = f ? Number(f[1]) / Number(f[2]) : Number.parseFloat(text)
  if (!Number.isFinite(v)) throw new Error('Enter a finite number')
  if (p.unit === 's' && /ms/.test(text)) v /= 1000
  if (p.scale === 0 && p.a !== 0) v = (v - p.b) / p.a
  else if (p.scale === 1) v = (Math.log2((v - p.d) / p.a) - p.c) / p.b
  else if (p.scale === 2) v = 10 ** (v / 60)
  else if (p.scale === 3) v = (Math.log(v * p.d - p.c) - p.a) / (p.b - p.a)
  if (!Number.isFinite(v)) throw new Error('Value is outside this control’s range')
  return v
}
interface State {
  values: Record<number, number>
  name: string
  author: string
  macros: string[]
  xml: string
}
export function parsePreset(xml: string): State {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD/entity declarations are not supported')
  const doc = new DOMParser().parseFromString(xml, 'application/xml'),
    root = doc.documentElement
  if (
    doc.querySelector('parsererror') ||
    root.tagName !== 'patch' ||
    root.getAttribute('id') !== 'org.baconpaul.six-sines'
  )
    throw new Error('This is not a valid Six Sines preset')
  const version = Number(root.getAttribute('version'))
  if (!Number.isInteger(version) || version < 3)
    throw new Error('Please re-save this early preset in the native plugin before importing it')
  const values = Object.fromEntries(schema.params.map((p) => [p.id, p.default])),
    seen = new Set<number>()
  for (const el of root.querySelectorAll(':scope > params > p')) {
    const id = Number(el.getAttribute('id')),
      v = Number(el.getAttribute('v'))
    if (
      !el.hasAttribute('id') ||
      !el.hasAttribute('v') ||
      !Number.isInteger(id) ||
      !Number.isFinite(v) ||
      seen.has(id)
    )
      throw new Error('Preset has invalid or duplicate parameter values')
    seen.add(id)
    values[id] = v
  }
  // Mirrors native Patch migration rules for versions 3–12.
  if (version <= 3 && values[523]! > 0) values[523] = 1
  if (version === 5 && values[527] === 2) values[527] = 3
  if (version === 6 && values[527] === 1) values[527] = 0
  for (const n of schema.nodes) {
    const trigger = field(n, 'Env Trigger Mode')
    if (trigger && version === 5 && values[trigger.id] === 2) values[trigger.id] = 3
    if (
      trigger &&
      version === 7 &&
      !['mixer', 'macro'].includes(n.kind) &&
      values[trigger.id] === 5
    ) {
      values[trigger.id] = 3
      const oneShot = field(n, 'Is OneShot')
      if (oneShot) values[oneShot.id] = 1
    }
    if (n.kind === 'source' && version < 9) {
      const wf = field(n, 'Waveform')!
      let v = values[wf.id]!
      if (v > 3) v++
      values[wf.id] = ({ 6: 13, 8: 14, 10: 15, 12: 16 } as Record<number, number>)[v] ?? v
    }
    if (version <= 11) {
      const shape = field(n, 'LFO Shape'),
        deform = field(n, 'LFO Deform')
      if (shape && deform && values[shape.id] === 7) values[deform.id] = values[deform.id]! * 0.5
    }
  }
  if (version <= 10) values[557] = 0
  const macros = Array.from(
    { length: 6 },
    (_, i) =>
      root.querySelector(`macroNames > macroName[idx="${i}"]`)?.textContent || `Macro ${i + 1}`,
  )
  return {
    values,
    name: root.getAttribute('name') || 'Untitled',
    author: root.getAttribute('author') || '',
    macros,
    xml,
  }
}
export function serializePreset(state: State): string {
  const doc = new DOMParser().parseFromString(state.xml, 'application/xml'),
    root = doc.documentElement
  root.setAttribute('version', String(Math.max(12, Number(root.getAttribute('version')))))
  root.setAttribute('name', state.name)
  root.setAttribute('author', state.author)
  let params = root.querySelector(':scope > params')
  if (!params) {
    params = doc.createElement('params')
    root.appendChild(params)
  }
  const existing = new Map(
    Array.from(params.children).map((el) => [Number(el.getAttribute('id')), el]),
  )
  for (const [id, value] of Object.entries(state.values)) {
    let el = existing.get(Number(id))
    if (!el) {
      el = doc.createElement('p')
      el.setAttribute('id', id)
      params.appendChild(el)
    }
    el.setAttribute('v', Object.is(value, -0) ? '-0' : String(value))
  }
  let names = root.querySelector('macroNames')
  if (!names) {
    names = doc.createElement('macroNames')
    root.appendChild(names)
  }
  state.macros.forEach((name, i) => {
    let el = names!.querySelector(`macroName[idx="${i}"]`)
    if (!el) {
      el = doc.createElement('macroName')
      el.setAttribute('idx', String(i))
      names!.appendChild(el)
    }
    el.textContent = name
  })
  return new XMLSerializer().serializeToString(doc)
}
export interface ParameterChange {
  id: number
  value: number
}
export function createEditorStore(
  hooks: {
    parameters?: (changes: ParameterChange[]) => void
    preset?: (bytes: Uint8Array) => void
    metadata?: (bytes: Uint8Array) => void
  } = {},
) {
  const state = reactive<State>(parsePreset(initXml))
  const selection = ref(node('main')),
    dirty = ref(false),
    error = ref(''),
    notice = ref('')
  const undoStack = ref<string[]>([]),
    redoStack = ref<string[]>([])
  const snapshot = () => JSON.stringify(state)
  let transaction = '',
    transactionDepth = 0
  function begin() {
    if (transactionDepth++ === 0) transaction = snapshot()
  }
  function end() {
    if (transactionDepth === 0 || --transactionDepth > 0) return
    if (transaction && transaction !== snapshot()) {
      undoStack.value.push(transaction)
      if (undoStack.value.length > 60) undoStack.value.shift()
      redoStack.value = []
      dirty.value = true
    }
    transaction = ''
  }
  function set(id: number, value: number) {
    const p = byId.get(id)
    if (!p || !Number.isFinite(value)) return
    const alone = !transaction
    if (alone) begin()
    const max = p.id === 527 ? 2 : p.name.endsWith('Env Trigger Mode') ? 4 : p.max
    const previous = state.values[id]
    state.values[id] = Math.fround(
      Math.min(max, Math.max(p.min, p.type === 1 || p.type === 2 ? Math.round(value) : value)),
    )
    if (previous !== state.values[id]) hooks.parameters?.([{ id, value: state.values[id]! }])
    if (alone) end()
  }
  function editMetadata(fn: () => void) {
    begin()
    const before = snapshot()
    fn()
    end()
    if (before !== snapshot()) hooks.metadata?.(exportPreset())
  }
  function loadPreset(input: string | Uint8Array, options: { silent?: boolean } = {}) {
    const parsed = parsePreset(typeof input === 'string' ? input : new TextDecoder().decode(input))
    Object.assign(state, parsed)
    dirty.value = false
    error.value = ''
    transaction = ''
    transactionDepth = 0
    undoStack.value = []
    redoStack.value = []
    if (!options.silent) hooks.preset?.(exportPreset())
  }
  // Host values are native storage values: preserve them without UI clamping.
  // This path deliberately does not snapshot, emit, or mark the patch dirty.
  function setParameters(changes: ParameterChange[]) {
    for (const { id, value } of changes) {
      if (Number.isInteger(id) && Number.isFinite(value) && byId.has(id)) {
        state.values[id] = value
      }
    }
  }
  const getParameterValues = (): Record<string, number> => ({ ...state.values })
  const exportPreset = () => new TextEncoder().encode(serializePreset(state))
  function restore(saved: string) {
    const next = JSON.parse(saved) as State
    const changes = Object.entries(next.values)
      .filter(([id, v]) => state.values[Number(id)] !== v)
      .map(([id, value]) => ({ id: Number(id), value }))
    const metadataChanged =
      state.name !== next.name ||
      state.author !== next.author ||
      state.macros.some((name, i) => name !== next.macros[i])
    Object.assign(state, next)
    if (changes.length) hooks.parameters?.(changes)
    if (metadataChanged) hooks.metadata?.(exportPreset())
  }
  function undo() {
    const s = undoStack.value.pop()
    if (s) {
      redoStack.value.push(snapshot())
      restore(s)
      dirty.value = true
    }
  }
  function redo() {
    const s = redoStack.value.pop()
    if (s) {
      undoStack.value.push(snapshot())
      restore(s)
      dirty.value = true
    }
  }
  function assign(n: Node, slot: number, source: number) {
    begin()
    set(n.modSource[slot]!, source)
    if (source >= 410 && source <= 415) set(40001 + 250 * (source - 410), 1)
    end()
  }
  function uses(index: number) {
    return schema.nodes.flatMap((n) =>
      n.modSource.flatMap((id, slot) =>
        [400 + index, 410 + index].includes(state.values[id]!) &&
        state.values[n.modTarget[slot]!] !== 0
          ? [
              {
                n,
                slot,
                target:
                  n.targets.find((t) => t.value === state.values[n.modTarget[slot]!])?.label ||
                  'Off',
              },
            ]
          : [],
      ),
    )
  }
  return {
    state,
    selection,
    dirty,
    error,
    notice,
    set,
    begin,
    end,
    editMetadata,
    loadPreset,
    setParameters,
    getParameterValues,
    exportPreset,
    undo,
    redo,
    assign,
    uses,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    reset: () => loadPreset(initXml),
  }
}
export type EditorStore = ReturnType<typeof createEditorStore>
export const editorKey: InjectionKey<EditorStore> = Symbol('six-sines-editor')
