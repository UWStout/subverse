import { vi } from 'vitest'
import path from 'path'
import express from 'express'

// ---------------------------------------------------------------------------
// Mock Prisma client — shared mutable object so route modules see the same instance
// ---------------------------------------------------------------------------
export const mockPrisma = {
  user: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({})
  },
  class: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({})
  },
  offering: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({})
  },
  project: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({})
  },
  assignment: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 })
  }
}

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks()

  const resetModel = (model) => {
    model.findFirst.mockResolvedValue(null)
    model.findUnique.mockResolvedValue(null)
    model.findMany.mockResolvedValue([])
    model.create.mockResolvedValue({})
    model.update.mockResolvedValue({})
    model.delete.mockResolvedValue({})
  }

  for (const key of Object.values(mockPrisma)) {
    resetModel(key)
  }

  // Reset deleteMany on assignment (only model that has it)
  mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 0 })
})

// ---------------------------------------------------------------------------
// Mock bcryptjs — deterministic hash so we don't depend on real crypto
// ---------------------------------------------------------------------------
vi.doMock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$10$hashedpassword'),
    compare: vi.fn().mockResolvedValue(true)
  }
}))

// ---------------------------------------------------------------------------
// Mock the db module — use absolute path so it matches what server/routes/* resolves
// ---------------------------------------------------------------------------
const dbPath = path.resolve(__dirname, '..', 'server', 'db.js')

vi.doMock(dbPath, () => ({
  getDatabase: () => mockPrisma,
  initDatabase: () => mockPrisma
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fresh Express app with the given router mounted at `prefix`.
 */
export function createTestApp (router, prefix = '/') {
  const app = express()
  app.use(prefix, router)
  return app
}

/**
 * Standard test user fixture.
 */
export const TEST_USER = {
  id: 1,
  username: 'testuser',
  email: 'test@example.com',
  password_hash: '$2a$10$hashedpassword',
  type: 'STUDENT',
  verification_token: null,
  verification_sent_at: null,
  reset_token: null,
  reset_sent_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
}

/**
 * Standard test class fixture.
 */
export const TEST_CLASS = {
  id: 1,
  subject: 'CS',
  number: '101',
  title: 'Intro to Computer Science'
}

/**
 * Standard test offering fixture.
 */
export const TEST_OFFERING = {
  id: 1,
  class_id: 1,
  teacher_id: 1,
  term: 'FALL2025',
  section: 'A'
}

/**
 * Standard test project fixture.
 */
export const TEST_PROJECT = {
  id: 1,
  offering_id: 1,
  title: 'Final Project',
  description: 'Complete final assignment for the course'
}
