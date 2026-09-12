// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { nextTick, watch } from 'vue'
import { createEditorStore, parsePreset } from './model'
import { registerSixSinesEditor, type PresetChangeDetail } from './webcomponent'
import init from './data/init.sxsnp?raw'

afterEach(async () => {
  document.body.replaceChildren()
  await Promise.resolve()
  vi.unstubAllGlobals()
})

function mount() {
  registerSixSinesEditor()
  const element = document.createElement('six-sines-editor')
  const parameters = vi.fn()
  const preset = vi.fn()
  element.addEventListener('parameters-change', parameters)
  element.addEventListener('preset-change', preset)
  document.body.append(element)
  const root = element.shadowRoot!
  const button = (text: string) =>
    [...root.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text,
    )!
  return { element, root, parameters, preset, button }
}

test('host batches preserve reactive identity and siblings without history or echoes', () => {
  const parameters = vi.fn(),
    preset = vi.fn(),
    metadata = vi.fn()
  const store = createEditorStore({ parameters, preset, metadata })
  const values = store.state.values
  const changed = vi.fn(),
    sibling = vi.fn()
  const stop = watch(() => values[500], changed, { flush: 'sync' })
  const stopSibling = watch(() => values[1500], sibling, { flush: 'sync' })
  for (let i = 0; i < 100; i++) store.setParameters([{ id: 500, value: i / 100 }])
  expect(store.state.values).toBe(values)
  expect(changed).toHaveBeenCalled()
  expect(sibling).not.toHaveBeenCalled()
  expect(store.canUndo.value).toBe(false)
  expect(store.dirty.value).toBe(false)
  store.loadPreset(init, { silent: true })
  expect(parameters).not.toHaveBeenCalled()
  expect(preset).not.toHaveBeenCalled()
  expect(metadata).not.toHaveBeenCalled()
  stop()
  stopSibling()
})

test('actual element methods hydrate silently, render deltas and export native XML', async () => {
  expect(registerSixSinesEditor()).toBe(registerSixSinesEditor())
  const { element, root, parameters, preset } = mount()
  const xml = init.replace('</patch>', '<future flag="retained"/></patch>')
  element.loadPreset(xml)
  element.loadPreset(new TextEncoder().encode(xml))
  element.setParameters([{ id: 500, value: 0.375 }])
  await nextTick()
  expect(root.querySelector('[data-param-id="500"]')?.getAttribute('aria-valuenow')).toBe('0.375')
  expect(parameters).not.toHaveBeenCalled()
  expect(preset).not.toHaveBeenCalled()
  const snapshot = element.getParameterValues()
  snapshot['500'] = 99
  expect(element.getParameterValues()['500']).toBe(0.375)
  const output = new TextDecoder().decode(element.getPreset())
  expect(parsePreset(output).values).toEqual(element.getParameterValues())
  expect(output).toContain('<future flag="retained"/>')
  const nativeStore = createEditorStore()
  nativeStore.loadPreset(element.getPreset())
  expect(nativeStore.getParameterValues()).toEqual(element.getParameterValues())
  expect(() => element.loadPreset('invalid')).toThrow()
  expect(element.getParameterValues()['500']).toBe(0.375)
  expect(root.querySelector('style')?.textContent).toContain(':host')
})

test('user knob edits and undo emit native deltas, while metadata and reset emit whole presets', async () => {
  const { element, root, parameters, preset, button } = mount()
  root
    .querySelector('[data-param-id="500"]')!
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }),
    )
  await nextTick()
  expect(parameters.mock.calls[0]![0]).toBeInstanceOf(CustomEvent)
  expect(parameters.mock.calls[0]![0].detail.changes).toEqual([
    { id: 500, value: element.getParameterValues()['500'] },
  ])
  expect(preset).not.toHaveBeenCalled()
  button('Undo').click()
  await nextTick()
  expect(parameters).toHaveBeenCalledTimes(2)
  root.querySelector<HTMLButtonElement>('[aria-label="Edit preset name and author"]')!.click()
  await nextTick()
  const name = root.querySelector<HTMLInputElement>('[aria-label="Preset name"]')!
  name.value = 'Shared & native'
  name.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  const detail = preset.mock.calls.at(-1)![0].detail as PresetChangeDetail
  expect(parsePreset(detail.preset).name).toBe('Shared & native')
  expect(detail.values).toEqual(element.getParameterValues())
  root.querySelector<HTMLButtonElement>('[aria-label="Close preset details"]')!.click()
  await nextTick()
  root.querySelector<HTMLButtonElement>('[aria-label="Macro 1 assignments"]')!.click()
  await nextTick()
  const macro = root.querySelector<HTMLInputElement>('[aria-label="Macro name"]')!
  macro.value = 'Motion'
  macro.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
  expect(parsePreset(preset.mock.calls.at(-1)![0].detail.preset).macros[0]).toBe('Motion')
  button('Undo').click()
  await nextTick()
  expect(parsePreset(preset.mock.calls.at(-1)![0].detail.preset).macros[0]).not.toBe('Motion')
  button('Redo').click()
  await nextTick()
  expect(parsePreset(preset.mock.calls.at(-1)![0].detail.preset).macros[0]).toBe('Motion')
  button('New').click()
  await nextTick()
  button('Discard & continue').click()
  await nextTick()
  expect(parsePreset(preset.mock.calls.at(-1)![0].detail.preset).name).toBe(parsePreset(init).name)
})

test('factory URLs honor the host base and user loads emit full state', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => init })
  vi.stubGlobal('fetch', fetch)
  const { element, root, preset } = mount()
  element.presetBaseUrl = '/six-sines-ui'
  await nextTick()
  root.querySelector<HTMLButtonElement>('[aria-label="Next preset"]')!.click()
  await vi.waitFor(() => expect(preset).toHaveBeenCalledTimes(1))
  expect(fetch.mock.calls[0]![0]).toMatch(/^\/six-sines-ui\/presets\//)
  element.setAttribute('preset-base-url', '/other/')
  expect(element.presetBaseUrl).toBe('/other/')
})

test('detached hydration survives reconnect and keyboard shortcuts stay within the editor', async () => {
  const { element, root, parameters } = mount()
  const input = document.createElement('input')
  document.body.append(input)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
  expect(parameters).not.toHaveBeenCalled()
  element.remove()
  await Promise.resolve()
  element.setParameters([{ id: 500, value: 0.25 }])
  document.body.append(element)
  await nextTick()
  expect(root.querySelector('[data-param-id="500"]')?.getAttribute('aria-valuenow')).toBe('0.25')
})
