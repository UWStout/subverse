// Client test setup — the counterpart of server/test/setup.js.
// Registers jest-dom matchers (toBeInTheDocument, ...) for all component tests.
import { expect } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'

expect.extend(matchers)
