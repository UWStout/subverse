// Client test setup - the counterpart of server/test/setup.js.
// Registers jest-dom matchers (toBeInTheDocument, ...) for all component tests.
import { expect, beforeEach } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'

expect.extend(matchers)

// The app persists UI state (theme, filters, pagination) in localStorage;
// clear it between tests so a persisted value can never leak into the next
// test case and change its expectations.
beforeEach(() => {
  window.localStorage.clear()
})
