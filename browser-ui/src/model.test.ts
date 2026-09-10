// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createEditorStore, field, node, parsePreset, schema, serializePreset } from './model'
import init from './data/init.sxsnp?raw'

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.sxsnp') ? [join(dir, e.name)] : [])
}
const corpus = files('public/presets')
describe('native preset interchange', () => {
  test('every factory preset round trips without changing its migrated state', () => {
    expect(corpus).toHaveLength(216)
    for (const path of corpus) {
      const before = parsePreset(readFileSync(path, 'utf8'))
      const after = parsePreset(serializePreset(before))
      expect(after.values, path).toEqual(before.values)
      expect(after.name).toBe(before.name)
      expect(after.macros).toEqual(before.macros)
    }
  }, 90000)
  test('retains unknown parameters, XML extensions, and escaped metadata', () => {
    const state = parsePreset(init.replace('</params>', '<p id="999999" v="0.125"/></params>').replace('</patch>', '<future flag="yes"/></patch>'))
    state.name = 'A & B <C>'; state.macros[0] = 'Ring & shine'
    const output = serializePreset(state), result = parsePreset(output)
    expect(result.values[999999]).toBe(.125)
    expect(result.name).toBe(state.name)
    expect(result.macros[0]).toBe('Ring & shine')
    expect(output).toContain('<future flag="yes"')
  })
  test('rejects malformed and unrelated files without replacing a patch', () => {
    const s = createEditorStore(), before = s.exportPreset()
    for (const xml of ['garbage', '<patch/>', init.replace(/v="[^"]+"/, 'v="NaN"'), '<!DOCTYPE patch>' + init]) {
      expect(() => s.loadPreset(xml)).toThrow()
      expect(s.exportPreset()).toEqual(before)
    }
  })
  test('macro assignment, grouped undo, and exported native IDs', () => {
    const s = createEditorStore(), route = node('matrix', 14)
    s.begin(); s.set(field(route, 'Active')!.id, 1); s.assign(route, 0, 400); s.set(route.modTarget[0]!, 10); s.set(route.modDepth[0]!, .5); s.end()
    expect(s.uses(0)).toHaveLength(1)
    const values = parsePreset(new TextDecoder().decode(s.exportPreset())).values
    expect(values[32801]).toBe(1); expect(values[32870]).toBe(400); expect(values[32880]).toBe(10); expect(values[32871]).toBe(.5)
    s.undo(); expect(s.state.values[32871]).toBe(0)
    s.redo(); expect(s.state.values[32871]).toBe(.5)
    s.assign(route, 1, 410); expect(s.state.values[40001]).toBe(1)
  })
  test('all 42 nodes have common inspector parameters', () => {
    expect(schema.nodes).toHaveLength(42)
    for (const n of schema.nodes) for (const suffix of ['Attack Shape', 'Decay Shape', 'Release Shape', 'LFO Rate', 'LFO Shape', 'Env Power']) expect(field(n, suffix), n.group + suffix).toBeDefined()
  })
  const oracle = process.env.NATIVE_PRESETS
  test.skipIf(!oracle)('all factory migrations match the C++ loader', () => {
    for (const path of corpus) {
      const nativePath = join(oracle!, relative('public/presets', path))
      expect(existsSync(nativePath), nativePath).toBe(true)
      const actual = parsePreset(readFileSync(path, 'utf8')), expected = parsePreset(readFileSync(nativePath, 'utf8'))
      for (const p of schema.params) expect(Math.fround(actual.values[p.id]!), `${path}: ${p.name} (${p.id})`).toBeCloseTo(Math.fround(expected.values[p.id]!), 5)
    }
  }, 30000)
})
