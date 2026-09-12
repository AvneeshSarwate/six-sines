import { describe, expect, test } from 'vitest'
import { ref, watch } from 'vue'
import {
  applyPatches,
  createTracked,
  type Patch,
} from '../../../../avTools/packages/tracked-state/src/index'

describe('tracked state Vue consumer', () => {
  test('raw external edits reach Vue through the same dirty-gated adapter', () => {
    const engine = createTracked({ filter: { cutoff: 1 }, gain: 1 })
    const external = { cutoff: 2 }
    engine.state.filter = external
    const values = ref(engine.snapshot())
    engine.drain()
    let updates = 0
    const stop = watch(
      () => values.value.filter.cutoff,
      () => updates++,
      { flush: 'sync' },
    )
    external.cutoff = 3
    if (engine.dirty) values.value = applyPatches(values.value, engine.drain())
    expect(values.value.filter.cutoff).toBe(3)
    expect(updates).toBe(1)
    expect(engine.drain()).toEqual([])
    stop()
  })

  test('patches notify affected controls without notifying unchanged siblings', () => {
    const engine = createTracked({ filter: { cutoff: 1 }, gain: 1 })
    const values = ref(engine.snapshot())
    let cutoffUpdates = 0
    let gainUpdates = 0
    const stopCutoff = watch(
      () => values.value.filter.cutoff,
      () => cutoffUpdates++,
      { flush: 'sync' },
    )
    const stopGain = watch(
      () => values.value.gain,
      () => gainUpdates++,
      { flush: 'sync' },
    )

    // This is the entire receive adapter; individual controls do not handle patches.
    const receive = (patches: Patch[]) => {
      values.value = applyPatches(values.value, patches)
    }
    engine.state.filter.cutoff = 2
    receive(JSON.parse(JSON.stringify(engine.drain())))
    expect(values.value.filter.cutoff).toBe(2)
    expect(cutoffUpdates).toBe(1)
    expect(gainUpdates).toBe(0)

    engine.reconcile({ filter: { cutoff: 3 } }, { mode: 'merge' })
    receive(engine.drain())
    expect(cutoffUpdates).toBe(2)
    expect(gainUpdates).toBe(0)
    stopCutoff()
    stopGain()
  })

  test('the same receive adapter handles root arrays, additions and removals', () => {
    const engine = createTracked([1, 2])
    const values = ref(engine.snapshot())
    let updates = 0
    const stop = watch(
      () => values.value.length,
      () => updates++,
      { flush: 'sync' },
    )
    engine.state.push(3)
    values.value = applyPatches(values.value, engine.drain())
    expect(values.value).toEqual([1, 2, 3])
    expect(updates).toBe(1)
    stop()

    const objectEngine = createTracked<Record<string, number>>({ gain: 1 })
    const objectValues = ref(objectEngine.snapshot())
    let keyUpdates = 0
    const stopKeys = watch(
      () => Object.keys(objectValues.value).join(','),
      () => keyUpdates++,
      { flush: 'sync' },
    )
    objectEngine.state.cutoff = 2
    objectValues.value = applyPatches(objectValues.value, objectEngine.drain())
    delete objectEngine.state.gain
    objectValues.value = applyPatches(objectValues.value, objectEngine.drain())
    expect(objectValues.value).toEqual({ cutoff: 2 })
    expect(keyUpdates).toBe(2)
    stopKeys()
  })

  test('editing one note preserves the UI array and unrelated note objects', () => {
    const engine = createTracked({ notes: [{ pitch: 60 }, { pitch: 64 }] })
    const values = ref(engine.snapshot())
    const notes = values.value.notes
    const unchangedNote = notes[1]
    engine.state.notes[0]!.pitch = 62
    values.value = applyPatches(values.value, engine.drain())
    expect(values.value.notes).toBe(notes)
    expect(values.value.notes[1]).toBe(unchangedNote)
    expect(values.value.notes[0]!.pitch).toBe(62)
  })
})
