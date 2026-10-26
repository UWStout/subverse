import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { usePersistentState } from '../src/hooks/usePersistentState'

describe('usePersistentState', () => {
  it('starts with the default when nothing is stored', () => {
    const { result } = renderHook(() => usePersistentState('test.value', 'default'))
    expect(result.current[0]).toBe('default')
  })

  it('hydrates from localStorage on first render', () => {
    window.localStorage.setItem('accountant:test.value', JSON.stringify('remembered'))
    const { result } = renderHook(() => usePersistentState('test.value', 'default'))
    expect(result.current[0]).toBe('remembered')
  })

  it('writes updates back to localStorage', () => {
    const { result } = renderHook(() => usePersistentState('test.value', 1))
    act(() => { result.current[1](42) })
    expect(result.current[0]).toBe(42)
    expect(JSON.parse(window.localStorage.getItem('accountant:test.value'))).toBe(42)
  })

  it('supports functional updates like useState', () => {
    const { result } = renderHook(() => usePersistentState('test.page', 1))
    act(() => { result.current[1](p => p + 1) })
    expect(result.current[0]).toBe(2)
    expect(JSON.parse(window.localStorage.getItem('accountant:test.page'))).toBe(2)
  })

  it('falls back to the default when sanitize rejects the stored value', () => {
    window.localStorage.setItem('accountant:test.mode', JSON.stringify('neon'))
    const { result } = renderHook(() => usePersistentState(
      'test.mode',
      'light',
      v => (v === 'light' || v === 'dark' ? v : null)
    ))
    expect(result.current[0]).toBe('light')
  })

  it('falls back to the default when the stored payload is corrupt JSON', () => {
    window.localStorage.setItem('accountant:test.value', 'oops{')
    const { result } = renderHook(() => usePersistentState('test.value', 'default'))
    expect(result.current[0]).toBe('default')
  })
})
