import { vi } from 'vitest'
import jwt from 'jsonwebtoken'
import path from 'path'
import express from 'express'

// ---------------------------------------------------------------------------
// Pin JWT config before any module evaluates `dotenv/config`
// (server/middleware/auth.js). Vitest runs setupFiles before each test file's
// imports, and dotenv does not override values that are already set - so this
// wins over the project .env and any ambient shell env. Tests therefore always
// run against a known secret regardless of local development configuration.
// (None of this file's own imports load dotenv, so pinning here is safe.)
// ---------------------------------------------------------------------------
export const TEST_JWT_SECRET = 'test-secret-do-not-use-in-production'
process.env.JWT_SECRET = TEST_JWT_SECRET
process.env.JWT_TIMEOUT = '8h'

// ---------------------------------------------------------------------------
// Mock Prisma client - shared mutable object so route modules see the same instance
// ---------------------------------------------------------------------------
export const mockPrisma = {
  $queryRaw: vi.fn().mockResolvedValue([]),
  user: {
    count: vi.fn().mockResolvedValue(0),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({ _count: { _all: 0 } }),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({})
  },
  class: {
    count: vi.fn().mockResolvedValue(0),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({ _count: { _all: 0 } }),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({})
  },
  offering: {
    count: vi.fn().mockResolvedValue(0),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({ _count: { _all: 0 } }),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 })
  },
  project: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({ _count: { _all: 0 } }),
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
    if (model.count) model.count.mockResolvedValue(0)
    model.findFirst.mockResolvedValue(null)
    model.findUnique.mockResolvedValue(null)
    model.findMany.mockResolvedValue([])
    if (model.aggregate) model.aggregate.mockResolvedValue({ _count: { _all: 0 } })
    model.create.mockResolvedValue({})
    model.update.mockResolvedValue({})
    model.delete.mockResolvedValue({})
  }

  for (const key of Object.values(mockPrisma)) {
    if (typeof key !== 'object') continue // skip top-level fns like $queryRaw
    resetModel(key)
  }

  // Reset the raw-query mock and deleteMany on assignment and offering
  mockPrisma.$queryRaw.mockResolvedValue([])
  mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.offering.deleteMany.mockResolvedValue({ count: 0 })

  // Mailer delivers successfully by default
  mockMailer.sendVerificationEmail.mockResolvedValue({ accepted: [] })
  mockMailer.sendPasswordResetEmail.mockResolvedValue({ accepted: [] })
  mockMailer.sendSetPasswordEmail.mockResolvedValue({ accepted: [] })
})

// ---------------------------------------------------------------------------
// Mock bcryptjs - deterministic hash so we don't depend on real crypto
// ---------------------------------------------------------------------------
vi.doMock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2a$10$hashedpassword'),
    compare: vi.fn().mockResolvedValue(true)
  }
}))

// ---------------------------------------------------------------------------
// Mock the db module - use absolute path so it matches what server/routes/* resolves
// ---------------------------------------------------------------------------
const dbPath = path.resolve(__dirname, '..', 'db.js')

vi.doMock(dbPath, () => ({
  getDatabase: () => mockPrisma,
  initDatabase: () => mockPrisma
}))

// ---------------------------------------------------------------------------
// Mock the mailer - tests must never open a real SMTP connection (the project
// .env contains live Brevo credentials that dotenv would otherwise load).
// ---------------------------------------------------------------------------
const mailerPath = path.resolve(__dirname, '..', 'mailer.js')

export const mockMailer = {
  sendVerificationEmail: vi.fn().mockResolvedValue({ accepted: [] }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ accepted: [] }),
  sendSetPasswordEmail: vi.fn().mockResolvedValue({ accepted: [] }),
  buildVerificationUrl: (token) => `http://test.local/verify?token=${token}`,
  buildResetUrl: (token) => `http://test.local/reset-password?token=${token}`
}

vi.doMock(mailerPath, () => ({
  ...mockMailer,
  APP_BASE_URL: 'http://test.local'
}))

// ---------------------------------------------------------------------------
// Mock the SVN sync module - route tests must never talk to a real Docker
// daemon. The functions are no-ops by default; individual tests can assert on
// them via mockSubversion. (The dedicated subversion.test.js mocks docker.js
// itself and exercises the real sync logic.)
// ---------------------------------------------------------------------------
const subversionPath = path.resolve(__dirname, '..', 'subversion.js')

export const mockSubversion = {
  createRepository: vi.fn().mockResolvedValue(undefined),
  synchronizeRepositoryAccess: vi.fn().mockResolvedValue(undefined),
  renameRepository: vi.fn().mockResolvedValue(undefined),
  deleteRepository: vi.fn().mockResolvedValue(undefined),
  setUserPassword: vi.fn().mockResolvedValue(undefined),
  removeUser: vi.fn().mockResolvedValue(undefined),
  // Mirrors production semantics: sync failures are swallowed, never thrown.
  bestEffortSvn: async (label, fn) => { try { await fn() } catch { /* logged in prod */ } }
}

vi.doMock(subversionPath, () => ({ ...mockSubversion }))

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
  first_name: 'Test',
  last_name: 'User',
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
  term: 'FALL25',
  section: '101'
}

/**
 * Standard test project fixture.
 */
export const TEST_PROJECT = {
  id: 1,
  offering_id: 1,
  title: 'Final Project',
  slug: 'final-project',
  subversion_url: null,
  git_url: 'https://github.com/example/final-project.git',
  description: 'Complete final assignment for the course'
}

/**
 * A valid session token signed with the pinned test secret (see top of file),
 * which is what server/middleware/auth.js uses when running under vitest.
 */
export const AUTH_TOKEN = jwt.sign(
  { sub: TEST_USER.id, username: 'testuser', type: 'STUDENT' },
  TEST_JWT_SECRET,
  { expiresIn: '8h' }
)

/**
 * Sign a session token for an arbitrary identity (id / username / role).
 * Defaults match TEST_USER so fixtures stay consistent. Used to exercise
 * role-based authorization rules in route tests.
 */
export function makeToken ({ sub = TEST_USER.id, username = 'testuser', type = 'STUDENT' } = {}) {
  return jwt.sign({ sub, username, type }, TEST_JWT_SECRET, { expiresIn: '8h' })
}

/**
 * Wrap an Express app so every request it receives carries a valid session
 * token - simulates an authenticated client. Requests that already carry an
 * Authorization header are left untouched (used by the 401 tests).
 * Pass a custom token to change the default identity (defaults to AUTH_TOKEN,
 * which is a STUDENT).
 */
export function authedApp (app, token = AUTH_TOKEN) {
  return (req, res) => {
    if (!req.headers.authorization) {
      req.headers.authorization = `Bearer ${token}`
    }
    return app(req, res)
  }
}
