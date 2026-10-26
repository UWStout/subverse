import { useState } from 'react'
import { readStored, writeStored } from '../services/storage'

/**
 * Drop-in replacement for useState that remembers its value across page
 * reloads: the initial value is hydrated from localStorage (namespaced via
 * services/storage.js) and every update is written back.
 *
 * @param {string} key          logical storage key, e.g. 'users.filterType'
 * @param {*}      defaultValue used when nothing is stored yet or storage fails
 * @param {(v:*) => *} sanitize optional validator for the stored value;
 *                            return null to fall back to `defaultValue`
 *                            (e.g. reject a tampered theme mode)
 *
 * Functional updates (set(n => n + 1)) behave exactly like useState.
 */
export function usePersistentState (key, defaultValue, sanitize = v => v) {
  const [value, setValue] = useState(() => {
    const clean = sanitize(readStored(key, defaultValue))
    return clean == null ? defaultValue : clean
  })

  const set = (next) => {
    const resolved = typeof next === 'function' ? next(value) : next
    setValue(resolved)
    writeStored(key, resolved)
  }

  return [value, set]
}
