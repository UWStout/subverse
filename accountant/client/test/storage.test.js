import { describe, it, expect, vi } from 'vitest'
import { readStored, writeStored, storageKey } from '../src/services/storage'

describe('storage helpers', () => {
  it('namespaces keys under the accountant prefix', () => {
    expect(storageKey('theme')).toBe('accountant:theme')
    expect(storageKey('users.page')).toBe('accountant:users.page')
  })

  it('round-trips JSON values under the namespaced key', () => {
    writeStored('users.filterType', 'TEACHER')
    // Stored as JSON, under the prefixed key
    expect(window.localStorage.getItem('accountant:users.filterType')).toBe('"TEACHER"')
    expect(readStored('users.filterType')).toBe('TEACHER')

    writeStored('users.page', 3)
    expect(readStored('users.page')).toBe(3)
  })

  it('returns the fallback for missing keys', () => {
    expect(readStored('missing', 'fallback')).toBe('fallback')
    expect(readStored('missing')).toBeUndefined()
  })

  it('returns the fallback when the stored payload is not valid JSON', () => {
    window.localStorage.setItem('accountant:broken', '{not json')
    expect(readStored('broken', 42)).toBe(42)
  })

  it('does not throw when storage access is blocked', () => {
    // Simulate a browser that refuses storage access (e.g. private mode).
    const getItemSpy = vi.spyOn(window.localStorage, 'getItem')
      .mockImplementation(() => { throw new Error('access denied') })
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')
      .mockImplementation(() => { throw new Error('access denied') })

    expect(readStored('theme', 'light')).toBe('light')
    expect(() => writeStored('theme', 'dark')).not.toThrow()

    getItemSpy.mockRestore()
    setItemSpy.mockRestore()
  })
})
