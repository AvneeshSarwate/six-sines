import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' })
for (const key of [
  'window',
  'document',
  'HTMLElement',
  'Element',
  'SVGElement',
  'Node',
  'customElements',
  'CustomEvent',
  'DOMParser',
  'XMLSerializer',
])
  globalThis[key] = dom.window[key]

const { registerSixSinesEditor } = await import('../dist-webcomponent/six-sines-editor.js')
assert.equal(registerSixSinesEditor(), registerSixSinesEditor())
const element = document.createElement('six-sines-editor')
assert.equal(element.presetBaseUrl, new URL('../dist-webcomponent/', import.meta.url).href)
let echoes = 0
element.addEventListener('parameters-change', () => echoes++)
element.addEventListener('preset-change', () => echoes++)
// These methods also work before connection.
element.loadPreset(
  await readFile(new URL('../dist-webcomponent/init.sxsnp', import.meta.url), 'utf8'),
)
element.setParameters([{ id: 500, value: 0.375 }])
document.body.append(element)
assert.equal(element.getParameterValues()['500'], 0.375)
assert.equal(
  element.shadowRoot.querySelector('[data-param-id="500"]').getAttribute('aria-valuenow'),
  '0.375',
)
assert.match(new TextDecoder().decode(element.getPreset()), /id="500" v="0.375"/)
assert.equal(echoes, 0)
const style = element.shadowRoot.querySelector('style').textContent
assert.match(style, /:host/)
assert.match(style, /data:font/)
element.remove()
await Promise.resolve()
dom.window.close()
console.log(
  'Built ES module: registration, DOM, silent hydration, native export, embedded styles/fonts passed',
)
