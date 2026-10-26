/**
 * Namespaced localStorage helpers for persisting lightweight UI state
 * (theme, table filters, pagination) across visits.
 *
 * Every key is stored under the 'accountant:' prefix so it cannot collide
 * with other apps on the same origin. All access is wrapped in try/catch:
 * storage may be unavailable (private browsing, blocked storage, quota) and
 * a persistence failure must never break the UI - state simply won't stick.
 */

const PREFIX = 'accountant:'

/** Full localStorage key for an app-level logical key. */
export function storageKey (key) {
  return `${PREFIX}${key}`
}

/**
 * Read a JSON value from localStorage under the app namespace.
 * Returns `fallback` when the key is missing, the payload is not valid
 * JSON, or storage is unavailable.
 */
export function readStored (key, fallback = undefined) {
  try {
    const raw = window.localStorage.getItem(storageKey(key))
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

/**
 * Write a JSON value to localStorage under the app namespace.
 * Silently ignores storage failures (see module note).
 */
export function writeStored (key, value) {
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(value))
  } catch {
    // Storage unavailable or full - state stays in memory only.
  }
}
