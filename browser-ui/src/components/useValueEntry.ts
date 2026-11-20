import { nextTick, ref, useTemplateRef, watch, type ComputedRef, type Ref } from 'vue'
import { display, readDisplay, type Parameter } from '../model'

interface EntryStore {
  set(id: number, value: number): void
  error: Ref<string>
}

/**
 * The type-an-exact-value box shared by knobs and sliders: a one-shot editor
 * over the current value. It closes when the control is reused for another
 * parameter (the inspector swaps ids when another node is selected), when the
 * value changes from anywhere else (a drag, the host, an undo), and on blur,
 * so it never shows a stale number.
 */
export function useValueEntry(
  store: EntryStore,
  param: ComputedRef<Parameter | undefined>,
  value: ComputedRef<number>,
) {
  const editing = ref(false)
  const text = ref('')
  // The component's <input ref="value-entry">
  const entry = useTemplateRef<HTMLInputElement>('value-entry')
  let committing = false

  function open() {
    const p = param.value
    if (!p) return
    text.value = display(p, value.value)
    editing.value = true
    void nextTick(() => {
      entry.value?.focus()
      entry.value?.select()
    })
  }
  function cancel() {
    editing.value = false
  }
  function commit() {
    const p = param.value
    if (!editing.value || !p) return
    // Unchanged text (Enter or a click away without typing): just close
    if (text.value === display(p, value.value)) return cancel()
    try {
      committing = true
      store.set(p.id, readDisplay(p, text.value))
      editing.value = false
    } catch (e) {
      store.error.value = String(e)
    } finally {
      committing = false
    }
  }
  watch(
    () => param.value?.id,
    () => cancel(),
  )
  watch(value, () => {
    if (editing.value && !committing) cancel()
  })
  return { editing, text, open, cancel, commit }
}
