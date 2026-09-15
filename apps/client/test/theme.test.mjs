import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { useThemeStore } from '../src/stores/theme.ts'

const setup = (saved = null, blocked = false) => {
  setActivePinia(createPinia())
  let value = saved
  const storage = {
    getItem: () => { if (blocked) throw new Error('Storage blocked'); return value },
    setItem: (_key, next) => { if (blocked) throw new Error('Storage blocked'); value = next },
  }
  const calls = []
  const controller = { set: (mode) => calls.push(mode) }
  const store = useThemeStore()
  store.initialize(controller, storage)
  return { store, controller, storage, calls, saved: () => value }
}

test('theme preferences', async (suite) => {
  await suite.test('happy path', () => {
    for (const row of [
      { saved: null, selected: 'dark', initial: false, expected: true },
      { saved: 'dark', selected: 'light', initial: true, expected: false },
      { saved: 'light', selected: 'system', initial: false, expected: 'auto' },
      { saved: 'system', selected: 'dark', initial: 'auto', expected: true },
    ]) {
      const state = setup(row.saved)
      assert.equal(state.calls[0], row.initial)
      state.store.select(row.selected)
      assert.equal(state.store.mode, row.selected)
      assert.equal(state.saved(), row.selected)
      state.store.initialize(state.controller, state.storage)
      assert.equal(state.calls.at(-1), row.expected)
    }
  })

  await suite.test('failure path', () => {
    for (const saved of ['invalid', '', 'DARK']) {
      const state = setup(saved)
      assert.equal(state.store.mode, 'light')
      assert.throws(() => state.store.select(saved), /Unsupported theme/)
      assert.deepEqual(state.calls, [false])
    }
    const state = setup(null, true)
    state.store.select('dark')
    assert.equal(state.store.mode, 'dark')
    assert.equal(state.calls.at(-1), true)
  })
})
