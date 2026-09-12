<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import {
  byId,
  createEditorStore,
  editorKey,
  field,
  node,
  readDisplay,
  type Node,
  type EditorStore,
  type ParameterChange,
} from './model'
import presets from './data/presets.json'
import Knob from './components/Knob.vue'
import PlaySettings from './components/PlaySettings.vue'
import MatrixMode from './components/MatrixMode.vue'
import Inspector from './components/Inspector.vue'
const props = withDefaults(
  defineProps<{
    playable?: boolean
    presetBaseUrl?: string
    downloadOnExport?: boolean
    editorStore?: EditorStore
    localKeyboard?: boolean
  }>(),
  { downloadOnExport: true },
)
const emit = defineEmits<{
  export: [bytes: Uint8Array, filename: string]
  parameters: [changes: ParameterChange[]]
  presetLoad: [bytes: Uint8Array]
}>()
const s =
  props.editorStore ??
  createEditorStore({
    parameters: (changes) => emit('parameters', changes),
    preset: (bytes) => emit('presetLoad', bytes),
  })
provide(editorKey, s)
const { state, selection, dirty, error, notice, canUndo, canRedo } = s
const library = ref(false),
  settings = ref(false),
  help = ref(false),
  metadata = ref(false),
  search = ref(''),
  category = ref('All'),
  filter = ref(''),
  theme = ref('dark')
const fileInput = ref<HTMLInputElement>(),
  selectedPreset = ref(-1),
  pending = ref<null | (() => void)>(null)
const filtered = computed(() =>
  presets.filter(
    (p) =>
      (category.value === 'All' || p.category === category.value) &&
      p.name.toLowerCase().includes(search.value.toLowerCase()),
  ),
)
const categories = ['All', ...new Set(presets.map((p) => p.category))]
const rows = Array.from({ length: 6 }, (_, target) =>
  Array.from({ length: target + 1 }, (_, source) => ({
    source,
    target,
    n:
      source === target
        ? node('feedback', source)
        : node('matrix', (target * (target - 1)) / 2 + source),
  })),
)
function select(n: Node) {
  selection.value = n
}
function val(id: number) {
  return state.values[id] ?? byId.get(id)?.default ?? 0
}
function toggle(id: number) {
  s.set(id, val(id) > 0.5 ? 0 : 1)
}
function ratioChanged(e: Event, i: number) {
  const input = e.target as HTMLInputElement,
    id = 1500 + (i - 1) * 250
  try {
    s.set(id, readDisplay(byId.get(id)!, input.value))
  } catch (err) {
    error.value = String(err)
  }
  input.value = (2 ** val(id)).toFixed(4)
}
function sourceAudioIn(i: number) {
  return val(1505 + (i - 1) * 250) === 21
}
function activeId(n: Node) {
  return field(n, 'Active')?.id ?? field(n, 'Power')?.id ?? 0
}
function primary(n: Node) {
  return field(n, 'Depth')?.id ?? field(n, 'Level')?.id ?? n.params[0]!
}
function discardPending() {
  pending.value?.()
  pending.value = null
}
function request(fn: () => void) {
  if (dirty.value) pending.value = fn
  else fn()
}
async function loadFactory(p: (typeof presets)[number]) {
  try {
    const response = await fetch(
      (props.presetBaseUrl ?? import.meta.env.BASE_URL) + p.path.replace(/^\//, ''),
    )
    if (!response.ok) throw new Error('Could not load preset')
    s.loadPreset(await response.text())
    selectedPreset.value = presets.indexOf(p)
    library.value = false
    notice.value = `Loaded ${p.name}`
  } catch (e) {
    error.value = String(e)
  }
}
async function importFile(file?: File) {
  if (!file) return
  try {
    s.loadPreset(await file.text())
    selectedPreset.value = -1
    notice.value = `Imported ${file.name}`
  } catch (e) {
    error.value = String(e)
  }
}
function onDrop(e: DragEvent) {
  const file = e.dataTransfer?.files[0]
  if (file) request(() => void importFile(file))
}
function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  request(() => void importFile(f))
  input.value = ''
}
function download() {
  const bytes = s.exportPreset(),
    filename = (state.name || 'Untitled').replace(/[\\/:*?"<>|]/g, '_') + '.sxsnp'
  const a = document.createElement('a'),
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/xml' }))
  a.href = url
  a.download = filename
  if (props.downloadOnExport) a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  emit('export', bytes, filename)
  dirty.value = false
  notice.value = 'Preset exported'
}
function jog(d: number) {
  request(
    () => void loadFactory(presets[(selectedPreset.value + d + presets.length) % presets.length]!),
  )
}
function keyboard(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    library.value = false
    settings.value = false
    help.value = false
    metadata.value = false
    pending.value = null
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    download()
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key === 'z' &&
    !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)
  ) {
    e.preventDefault()
    e.shiftKey ? s.redo() : s.undo()
  }
}
onMounted(() => {
  if (!props.localKeyboard) window.addEventListener('keydown', keyboard)
})
onBeforeUnmount(() => window.removeEventListener('keydown', keyboard))
defineExpose({
  loadPreset: s.loadPreset,
  exportPreset: s.exportPreset,
  setParameters: s.setParameters,
  getParameterValues: s.getParameterValues,
})
</script>
<template>
  <main
    class="workspace"
    :data-theme="theme"
    @keydown="props.localKeyboard && keyboard($event)"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <header class="app-toolbar">
      <div class="wordmark">SIX SINES <span>PRESET EDITOR</span></div>
      <nav>
        <button
          @click="
            request(() => {
              s.reset()
              selectedPreset = -1
            })
          "
        >
          New</button
        ><button @click="fileInput?.click()">Import</button
        ><button
          :disabled="!canUndo"
          aria-label="Undo"
          @click="s.undo"
        >
          ↶</button
        ><button
          :disabled="!canRedo"
          aria-label="Redo"
          @click="s.redo"
        >
          ↷</button
        ><button
          @click="help = true"
          aria-label="Help"
        >
          ?</button
        ><button
          class="export-button"
          @click="download"
        >
          Export preset <span>↗</span>
        </button>
      </nav>
      <input
        ref="fileInput"
        type="file"
        accept=".sxsnp,.xml"
        hidden
        aria-label="Import preset file"
        @change="onFile"
      />
    </header>
    <div class="instrument">
      <header class="preset-strip">
        <svg
          class="sine-logo"
          viewBox="0 0 110 40"
          aria-hidden="true"
        >
          <path
            v-for="i in 6"
            :key="i"
            :d="
              Array.from(
                { length: 111 },
                (_, x) => `${x ? 'L' : 'M'}${x},${20 + 17 * Math.sin(x / 17 + i * 0.55)}`,
              ).join(' ')
            "
            fill="none"
            stroke="#999"
            stroke-width=".8"
          /></svg
        ><button
          aria-label="Previous preset"
          @click="jog(-1)"
        >
          ◀</button
        ><button
          class="preset-name"
          @click="library = true"
        >
          {{ state.name }}<span v-if="dirty"> *</span></button
        ><button
          aria-label="Next preset"
          @click="jog(1)"
        >
          ▶</button
        ><button
          class="preset-info"
          aria-label="Edit preset name and author"
          @click="metadata = true"
        >
          •••</button
        ><span class="editor-badge">{{ playable ? 'LIVE ENGINE' : 'PRESET ONLY' }}</span>
      </header>
      <div class="instrument-grid">
        <section class="sources panel">
          <h2>Source</h2>
          <div class="source-grid">
            <div
              v-for="i in 6"
              :key="i"
              class="source-cell"
              :class="{ selected: selection.group === node('source', i - 1).group }"
            >
              <button
                class="ratio-jog"
                :disabled="sourceAudioIn(i)"
                :aria-label="`Increase Op ${i} ratio`"
                @click="
                  s.set(
                    1500 + (i - 1) * 250,
                    Math.log2(Math.max(0.01, 2 ** val(1500 + (i - 1) * 250) + 1)),
                  )
                "
              >
                ▴</button
              ><input
                class="ratio-value"
                :disabled="sourceAudioIn(i)"
                :aria-label="`Op ${i} ratio`"
                :value="(2 ** val(1500 + (i - 1) * 250)).toFixed(4)"
                @focus="select(node('source', i - 1))"
                @change="ratioChanged($event, i)"
              /><button
                class="ratio-jog"
                :disabled="sourceAudioIn(i)"
                :aria-label="`Decrease Op ${i} ratio`"
                @click="
                  s.set(
                    1500 + (i - 1) * 250,
                    Math.log2(Math.max(0.01, 2 ** val(1500 + (i - 1) * 250) - 1)),
                  )
                "
              >
                ▾
              </button>
              <div class="source-label">
                <button
                  class="power"
                  :class="{ on: val(1501 + (i - 1) * 250) > 0.5 }"
                  :aria-label="`Op ${i} source power`"
                  :aria-pressed="val(1501 + (i - 1) * 250) > 0.5"
                  @click="toggle(1501 + (i - 1) * 250)"
                >
                  ⏻</button
                ><button
                  :aria-label="`Edit Op ${i} source`"
                  @click="select(node('source', i - 1))"
                >
                  Op {{ i }}
                </button>
              </div>
            </div>
          </div>
        </section>
        <section class="main-controls panel">
          <h2>Main</h2>
          <div class="main-knobs">
            <Knob
              :id="500"
              label="Level"
              @select="select(node('main'))"
            /><Knob
              :id="537"
              label="Pan"
              @select="select(node('pan'))"
            /><Knob
              :id="536"
              label="Tune"
              @select="select(node('tune'))"
            />
          </div>
        </section>
        <section class="matrix panel">
          <h2>Matrix <span class="panel-hint">audio-rate routing</span></h2>
          <div class="matrix-rows">
            <div
              v-for="(row, i) in rows"
              :key="i"
              class="matrix-row"
            >
              <div
                v-for="cell in row"
                :key="cell.n.group"
                class="matrix-cell"
                :class="{ selected: selection.group === cell.n.group }"
              >
                <div class="cell-controls">
                  <div class="cell-switches">
                    <button
                      class="power"
                      :class="{ on: val(activeId(cell.n)) > 0.5 }"
                      :disabled="cell.n.kind === 'feedback' && sourceAudioIn(cell.source + 1)"
                      :aria-label="`${cell.n.group} power`"
                      :aria-pressed="val(activeId(cell.n)) > 0.5"
                      @click="toggle(activeId(cell.n))"
                    >
                      ⏻</button
                    ><MatrixMode
                      v-if="cell.source !== cell.target"
                      :node="cell.n"
                    />
                  </div>
                  <Knob
                    :disabled="cell.n.kind === 'feedback' && sourceAudioIn(cell.source + 1)"
                    :id="primary(cell.n)"
                    @select="select(cell.n)"
                  />
                </div>
                <button
                  class="cell-label"
                  :aria-label="`Edit ${cell.n.group}`"
                  @click="select(cell.n)"
                >
                  Op {{ cell.source + 1 }} {{ cell.source === cell.target ? '↩' : '→' }}
                </button>
              </div>
            </div>
          </div>
        </section>
        <section class="mixer panel">
          <h2>Mixer</h2>
          <div
            v-for="i in 6"
            :key="i"
            class="mixer-row"
          >
            <div class="mixer-switches">
              <button
                class="power"
                :class="{ on: val(20001 + (i - 1) * 100) > 0.5 }"
                :aria-label="`Op ${i} mixer power`"
                @click="toggle(20001 + (i - 1) * 100)"
              >
                ⏻</button
              ><button
                class="solo"
                :class="{ on: val(20043 + (i - 1) * 100) > 0.5 }"
                :aria-label="`Solo Op ${i}`"
                @click="toggle(20043 + (i - 1) * 100)"
              >
                S
              </button>
            </div>
            <Knob
              :id="20000 + (i - 1) * 100"
              :label="`Op ${i} Level`"
              @select="select(node('mixer', i - 1))"
            /><Knob
              :id="20015 + (i - 1) * 100"
              label="Pan"
              @select="select(node('mixer', i - 1))"
            />
          </div>
        </section>
        <section class="macros panel">
          <h2>Macros</h2>
          <div class="macro-grid">
            <div
              v-for="i in 6"
              :key="i"
              class="macro-cell"
              :class="{ selected: selection.group === node('macro', i - 1).group }"
            >
              <div class="cell-controls">
                <div class="cell-switches">
                  <button
                    class="power"
                    :class="{ on: val(40001 + (i - 1) * 250) > 0.5 }"
                    :aria-label="`Macro ${i} power`"
                    @click="toggle(40001 + (i - 1) * 250)"
                  >
                    ⏻</button
                  ><button
                    class="usage"
                    :aria-label="`Macro ${i} assignments`"
                    @click="select(node('macro', i - 1))"
                  >
                    {{ s.uses(i - 1).length }}
                  </button>
                </div>
                <Knob
                  :id="40000 + (i - 1) * 250"
                  @select="select(node('macro', i - 1))"
                />
              </div>
              <button
                class="cell-label"
                @click="select(node('macro', i - 1))"
              >
                {{ state.macros[i - 1] }}
              </button>
            </div>
          </div>
        </section>
        <section class="settings-launch panel">
          <h2>Settings</h2>
          <button
            class="gear"
            aria-label="Open settings"
            @click="settings = true"
          >
            ⚙
          </button>
          <div><span>Native presets</span><small>.sxsnp</small></div>
        </section>
        <Inspector />
      </div>
      <footer class="instrument-footer">
        <span>Six Sines · browser edition</span><span>{{ state.author || 'No author' }}</span
        ><span>Vue / preset format 12</span>
      </footer>
    </div>
    <footer class="workspace-footer">
      <span>Drag knobs · Shift for fine adjustment · Double-click to enter a value</span
      ><span role="status">{{ notice || 'Import a preset or start from Init.' }}</span>
    </footer>
    <div
      v-if="error"
      class="error-toast"
      role="alert"
    >
      {{ error
      }}<button
        aria-label="Dismiss error"
        @click="error = ''"
      >
        ×
      </button>
    </div>
    <div
      v-if="library"
      class="modal-backdrop"
      @click.self="library = false"
    >
      <section
        class="dialog preset-library"
        role="dialog"
        aria-modal="true"
        aria-label="Preset library"
      >
        <header>
          <h2>
            Preset library <small>{{ presets.length }} factory presets</small>
          </h2>
          <button
            aria-label="Close preset library"
            @click="library = false"
          >
            ×
          </button>
        </header>
        <input
          v-model="search"
          type="search"
          placeholder="Search presets…"
          aria-label="Search presets"
        />
        <div class="library-body">
          <nav>
            <button
              v-for="c in categories"
              :key="c"
              :class="{ chosen: category === c }"
              @click="category = c"
            >
              {{ c }}
            </button>
          </nav>
          <div class="preset-results">
            <button
              v-for="p in filtered"
              :key="p.path"
              @click="request(() => void loadFactory(p))"
            >
              <span>{{ p.name }}</span
              ><small>{{ p.category }}</small>
            </button>
            <p v-if="!filtered.length">No matching presets.</p>
          </div>
        </div>
      </section>
    </div>
    <div
      v-if="settings"
      class="modal-backdrop"
      @click.self="settings = false"
    >
      <section
        class="dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <header>
          <h2>Play & output settings</h2>
          <button
            aria-label="Close settings"
            @click="settings = false"
          >
            ×
          </button>
        </header>
        <label class="theme-control"
          >Appearance<select v-model="theme">
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select></label
        ><input
          v-model="filter"
          placeholder="Find a setting…"
          aria-label="Find setting"
        />
        <div class="settings-fields"><PlaySettings :search="filter" /></div>
      </section>
    </div>
    <div
      v-if="metadata"
      class="modal-backdrop"
      @click.self="metadata = false"
    >
      <section
        class="dialog metadata-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Preset details"
      >
        <header>
          <h2>Preset details</h2>
          <button
            aria-label="Close preset details"
            @click="metadata = false"
          >
            ×
          </button>
        </header>
        <label
          >Name<input
            :value="state.name"
            aria-label="Preset name"
            @change="
              s.editMetadata(() => (state.name = ($event.target as HTMLInputElement).value))
            " /></label
        ><label
          >Author<input
            :value="state.author"
            aria-label="Preset author"
            @change="
              s.editMetadata(() => (state.author = ($event.target as HTMLInputElement).value))
            "
        /></label>
      </section>
    </div>
    <div
      v-if="help"
      class="modal-backdrop"
      @click.self="help = false"
    >
      <section
        class="dialog help-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Help"
      >
        <header>
          <h2>Six Sines preset editor</h2>
          <button
            aria-label="Close help"
            @click="help = false"
          >
            ×
          </button>
        </header>
        <p>
          Choose a source, routing cell, mixer channel, or macro to edit its envelope, LFO, and
          modulation assignments.
        </p>
        <p v-if="playable">
          Start audio above to play. Edits update the sound immediately. Import and export .sxsnp
          files to exchange presets with the plugin.
        </p>
        <p v-else>
          This component edits and exports native presets. Connect the exported bytes to your own
          Six Sines browser engine to hear them.
        </p>
        <p>
          <b>Knobs:</b> drag vertically, Shift-drag for precision, double-click to type, Alt-click
          to reset. Focus a knob and use the arrow keys to adjust it.
        </p>
        <p>
          <b>Macros:</b> choose a macro in Other Modulation, choose a destination, and move the
          depth slider away from zero.
        </p>
        <p>
          <b>Shortcuts:</b> ⌘/Ctrl S exports; ⌘/Ctrl Z undoes; Shift ⌘/Ctrl Z redoes; Escape closes
          dialogs.
        </p>
      </section>
    </div>
    <div
      v-if="pending"
      class="modal-backdrop confirm-layer"
    >
      <section
        class="dialog"
        role="alertdialog"
        aria-label="Unsaved changes"
      >
        <h2>Discard unsaved changes?</h2>
        <p>Export your preset first if you want to keep these edits.</p>
        <div class="dialog-actions">
          <button @click="pending = null">Keep editing</button
          ><button @click="download">Export first</button
          ><button @click="discardPending">Discard & continue</button>
        </div>
      </section>
    </div>
  </main>
</template>
