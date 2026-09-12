import { createApp, h, shallowRef, type App } from 'vue'
import SixSinesEditor from './SixSinesEditor.vue'
import { createEditorStore, type ParameterChange } from './model'
import css from './editor.css?inline'

// Keep this a runtime URL; Vite otherwise treats './' as an asset import.
const moduleUrl = import.meta.url
const defaultAssetBase = new URL('./', moduleUrl).href

export interface ParametersChangeDetail {
  changes: ParameterChange[]
}
export interface PresetChangeDetail {
  preset: string
  values: Record<string, number>
}

/** Preset-only editor. The host owns audio and persistence. */
export class SixSinesEditorElement extends HTMLElement {
  static observedAttributes = ['preset-base-url']
  private app?: App
  private assetBase = shallowRef(defaultAssetBase)
  private store = createEditorStore({
    parameters: (changes) =>
      this.dispatchEvent(
        new CustomEvent<ParametersChangeDetail>('parameters-change', {
          detail: { changes },
          bubbles: true,
          composed: true,
        }),
      ),
    preset: (bytes) => this.presetChanged(bytes),
    metadata: (bytes) => this.presetChanged(bytes),
  })

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  get presetBaseUrl(): string {
    return this.assetBase.value
  }

  set presetBaseUrl(value: string) {
    this.assetBase.value = value.endsWith('/') ? value : value + '/'
  }

  attributeChangedCallback(_name: string, _old: string | null, value: string | null) {
    this.presetBaseUrl = value ?? defaultAssetBase
  }

  connectedCallback() {
    if (this.app) return
    const style = document.createElement('style')
    style.textContent = css.replaceAll(':root', ':host') + '\n:host { display: block; }'
    const mount = document.createElement('div')
    this.shadowRoot!.replaceChildren(style, mount)
    this.app = createApp({
      render: () =>
        h(SixSinesEditor, {
          editorStore: this.store,
          localKeyboard: true,
          presetBaseUrl: this.assetBase.value,
        }),
    })
    this.app.mount(mount)
  }

  disconnectedCallback() {
    // Moving the element within a document should retain the mounted UI.
    queueMicrotask(() => {
      if (!this.isConnected) {
        this.app?.unmount()
        this.app = undefined
      }
    })
  }

  getPreset(): Uint8Array {
    return this.store.exportPreset()
  }

  getParameterValues(): Record<string, number> {
    return this.store.getParameterValues()
  }

  loadPreset(input: string | Uint8Array): void {
    this.store.loadPreset(input, { silent: true })
  }

  setParameters(changes: ParameterChange[]): void {
    this.store.setParameters(changes)
  }

  private presetChanged(bytes: Uint8Array) {
    this.dispatchEvent(
      new CustomEvent<PresetChangeDetail>('preset-change', {
        detail: {
          preset: new TextDecoder().decode(bytes),
          values: this.getParameterValues(),
        },
        bubbles: true,
        composed: true,
      }),
    )
  }
}

/** Safe to call repeatedly, including after another copy registered the tag. */
export function registerSixSinesEditor(): CustomElementConstructor {
  const existing = customElements.get('six-sines-editor')
  if (existing) return existing
  customElements.define('six-sines-editor', SixSinesEditorElement)
  return SixSinesEditorElement
}

declare global {
  interface HTMLElementTagNameMap {
    'six-sines-editor': SixSinesEditorElement
  }
}
