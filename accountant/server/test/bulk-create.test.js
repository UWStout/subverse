import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import path from 'path'
import { parseBulkEntries, detectSeparator } from '../bulk-create.js'
import { mockPrisma, mockMailer, TEST_PROJECT, authedApp, makeToken } from './setup.js'

// ---------------------------------------------------------------------------
// Parser unit tests (pure functions - no database involved)
// ---------------------------------------------------------------------------

describe('parseBulkEntries', () => {
  describe('detectSeparator', () => {
    it('detects newlines with top priority', () => {
      expect(detectSeparator('a\nb')).toBe('newline')
      expect(detectSeparator('a\rb')).toBe('newline')
      expect(detectSeparator('a,b;c\nd')).toBe('newline')
    })

    it('detects semicolons over commas', () => {
      expect(detectSeparator('a;b,c')).toBe('semicolon')
    })

    it('falls back to commas', () => {
      expect(detectSeparator('a,b')).toBe('comma')
      expect(detectSeparator('a b')).toBe('comma')
    })
  })

  it('parses comma-separated entries with normal name order', () => {
    const { entries, errors } = parseBulkEntries('John Doe <jdoe@x.edu>, Jane Smith <jsmith@x.edu>')
    expect(errors).toEqual([])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ first_name: 'John', last_name: 'Doe', email: 'jdoe@x.edu', username: 'jdoe' })
    expect(entries[1]).toMatchObject({ first_name: 'Jane', last_name: 'Smith', email: 'jsmith@x.edu', username: 'jsmith' })
  })

  it('parses semicolon-separated entries with reversed name order (internal commas)', () => {
    const { entries, errors } = parseBulkEntries('Doe, John <jdoe@x.edu>; Smith, Jane <jsmith@x.edu>')
    expect(errors).toEqual([])
    expect(entries[0]).toMatchObject({ first_name: 'John', last_name: 'Doe' })
    expect(entries[1]).toMatchObject({ first_name: 'Jane', last_name: 'Smith' })
  })

  it('parses comma-separated entries with reversed name order (internal commas)', () => {
    const { entries, errors } = parseBulkEntries('Doe, John <jdoe@x.edu>, Smith, Jane <jsmith@x.edu>')
    expect(errors).toEqual([])
    expect(entries[0]).toMatchObject({ first_name: 'John', last_name: 'Doe', email: 'jdoe@x.edu' })
    expect(entries[1]).toMatchObject({ first_name: 'Jane', last_name: 'Smith', email: 'jsmith@x.edu' })
  })

  it('parses newline-separated entries mixing both name orders', () => {
    const { entries, errors } = parseBulkEntries('Doe, John <jdoe@x.edu>\nJane Smith <jsmith@x.edu>')
    expect(errors).toEqual([])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ first_name: 'John', last_name: 'Doe' })
    expect(entries[1]).toMatchObject({ first_name: 'Jane', last_name: 'Smith' })
  })

  it('handles CRLF line endings and trailing separators', () => {
    const crlf = parseBulkEntries('A, B <a@x.edu>\r\nC, D <c@x.edu>')
    expect(crlf.entries).toHaveLength(2)
    expect(crlf.errors).toEqual([])

    const trailing = parseBulkEntries('Doe, John <jdoe@x.edu>;')
    expect(trailing.entries).toHaveLength(1)
    expect(trailing.errors).toEqual([])
  })

  it('parses a single entry with no separator', () => {
    const { entries, errors } = parseBulkEntries('Doe, John <jdoe@my.university.edu>')
    expect(errors).toEqual([])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ first_name: 'John', last_name: 'Doe', email: 'jdoe@my.university.edu', username: 'jdoe' })
  })

  it('keeps multi-word last names together and allows single-word names', () => {
    const multi = parseBulkEntries('John Paul Doe <jpd@x.edu>')
    expect(multi.entries[0]).toMatchObject({ first_name: 'John', last_name: 'Paul Doe' })

    const single = parseBulkEntries('Plato <plato@x.edu>')
    expect(single.entries[0]).toMatchObject({ first_name: 'Plato', last_name: null })
  })

  it('skips blank lines but keeps their index position', () => {
    const { entries, errors } = parseBulkEntries('Doe, John <jdoe@x.edu>\n\nJane Smith <jsmith@x.edu>')
    expect(errors).toEqual([])
    expect(entries.map(e => e.index)).toEqual([1, 3])
  })

  it('returns no entries and no errors for blank input', () => {
    expect(parseBulkEntries('')).toEqual({ entries: [], errors: [] })
    expect(parseBulkEntries('   \n\t ')).toEqual({ entries: [], errors: [] })
  })

  it('reports a segment without an email address', () => {
    const { entries, errors } = parseBulkEntries('John Doe\nDoe, John <jdoe@x.edu>')
    expect(entries).toHaveLength(1)
    expect(errors).toEqual([{ index: 1, raw: 'John Doe', reason: 'Missing <email> address' }])
  })

  it('reports a segment with multiple email addresses', () => {
    const { entries, errors } = parseBulkEntries('Doe, John <a@x.edu> Smith, Jane <b@x.edu>; Other, Guy <g@x.edu>')
    expect(entries).toHaveLength(1)
    expect(errors).toEqual([{ index: 1, raw: 'Doe, John <a@x.edu> Smith, Jane <b@x.edu>', reason: 'Multiple <email> addresses in one entry' }])
  })

  it('reports invalid email addresses', () => {
    const noAt = parseBulkEntries('John Doe <notanemail>')
    expect(noAt.errors[0].reason).toBe("Invalid email address 'notanemail'")

    const noDomain = parseBulkEntries('John Doe <jdoe@>')
    expect(noDomain.errors[0].reason).toBe("Invalid email address 'jdoe@'")
  })

  it('reports entries missing a name', () => {
    const { errors } = parseBulkEntries('<jdoe@x.edu>')
    expect(errors).toEqual([{ index: 1, raw: '<jdoe@x.edu>', reason: 'Missing name before the <email> address' }])
  })

  it('reports malformed reversed names (empty side of the comma)', () => {
    const emptyLast = parseBulkEntries(', John <jdoe@x.edu>')
    expect(emptyLast.errors[0].reason).toContain('Malformed name')

    const emptyFirst = parseBulkEntries('Doe, <jdoe@x.edu>')
    expect(emptyFirst.errors[0].reason).toContain('Malformed name')
  })

  it('rejects labels or other garbage absorbed into a name', () => {
    const { entries, errors } = parseBulkEntries('Roster: Doe, John <jdoe@x.edu>')
    expect(entries).toEqual([])
    expect(errors[0].reason).toContain('Malformed name')
  })

  it('reports trailing garbage after the last entry in comma mode', () => {
    const { entries, errors } = parseBulkEntries('Doe, John <jdoe@x.edu> GARBAGE')
    expect(entries).toHaveLength(1)
    expect(errors).toEqual([{ index: 2, raw: 'GARBAGE', reason: 'Missing <email> address' }])
  })

  it('mixes valid entries and errors with correct indexes', () => {
    const { entries, errors } = parseBulkEntries('Doe, John <jdoe@x.edu>\ngarbage line\nJane Smith <jsmith@x.edu>')
    expect(entries.map(e => e.index)).toEqual([1, 3])
    expect(errors).toEqual([{ index: 2, raw: 'garbage line', reason: 'Missing <email> address' }])
  })
})

// ---------------------------------------------------------------------------
// Route tests - POST /user/bulk-create
// ---------------------------------------------------------------------------

async function getUserRouter () {
  vi.resetModules()
  const routePath = path.resolve(__dirname, '..', 'routes', 'user.js')
  const mod = await import(routePath)
  return mod.default
}

const ADMIN_TOKEN = makeToken({ sub: 10, username: 'admin', type: 'ADMIN' })
const TEACHER_TOKEN = makeToken({ sub: 20, username: 'teacher', type: 'TEACHER' })

/** An existing student account (full username + email match for jdoe@x.edu). */
const EXISTING_USER = { id: 5, username: 'jdoe', email: 'jdoe@x.edu' }

describe('POST /user/bulk-create', () => {
  let router
  let rawApp
  let app

  beforeEach(async () => {
    router = await getUserRouter()
    const express = await import('express')
    rawApp = express.default()
    rawApp.use('/user/', router)
    app = authedApp(rawApp)
  })

  it('returns 401 without a session token', async () => {
    const res = await request(rawApp)
      .post('/user/bulk-create')
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@x.edu>' })
    expect(res.status).toBe(401)
  })

  it('returns 403 for students', async () => {
    const res = await request(app)
      .post('/user/bulk-create')
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@x.edu>' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Students cannot create users')
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({})
    expect(res.status).toBe(400)

    const blank = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: '   ' })
    expect(blank.status).toBe(400)
  })

  it('returns 400 for a non-numeric project id', async () => {
    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: 'nope', entries: 'Doe, John <jdoe@x.edu>' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid project ID')
  })

  it('returns 404 when the project does not exist', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null)

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: 999, entries: 'Doe, John <jdoe@x.edu>' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Project not found')
  })

  it('returns 403 when a teacher targets a project in an offering they do not teach', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT) // offering_id: 1
    mockPrisma.offering.findUnique.mockResolvedValue({ id: 1, teacher_id: 99 })

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@x.edu>' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Teachers can only add users to projects in classes they teach')
  })

  it('returns 400 with details when no entry can be parsed', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'just some garbage text' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('No valid entries found')
    expect(res.body.details).toHaveLength(1)
  })

  it('creates password-less accounts, assigns them, and queues set-password emails', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
    mockPrisma.$queryRaw.mockResolvedValue([]) // nobody exists yet
    let nextId = 100
    mockPrisma.user.create.mockImplementation(async ({ data }) => ({ id: ++nextId, ...data }))
    mockPrisma.assignment.findUnique.mockResolvedValue(null)

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@x.edu>\nSmith, Jane <jsmith@x.edu>' })

    expect(res.status).toBe(200)
    expect(res.body.created).toBe(2)
    expect(res.body.assigned).toBe(0)
    expect(res.body.already_assigned).toBe(0)
    expect(res.body.total).toBe(2)
    expect(res.body.errors).toEqual([])
    expect(res.body.email_failures).toEqual([])
    expect(res.body.results.map(r => r.status)).toEqual(['created', 'created'])

    // Accounts are STUDENTs with a reset token and an unusable password hash
    const firstData = mockPrisma.user.create.mock.calls[0][0].data
    expect(firstData).toMatchObject({ username: 'jdoe', email: 'jdoe@x.edu', type: 'STUDENT', first_name: 'John', last_name: 'Doe' })
    expect(firstData.password_hash).toBe('$2a$10$hashedpassword') // bcrypt mock
    expect(firstData.reset_token).toMatch(/^[a-f0-9]{64}$/)
    expect(firstData.verification_token).toBeUndefined()

    // Each new account is assigned to the project
    expect(mockPrisma.assignment.create).toHaveBeenCalledTimes(2)
    expect(mockPrisma.assignment.create).toHaveBeenCalledWith({ data: { student_id: 101, project_id: TEST_PROJECT.id } })

    // One set-password email per created account, carrying its reset token
    expect(mockMailer.sendSetPasswordEmail).toHaveBeenCalledTimes(2)
    expect(mockMailer.sendSetPasswordEmail.mock.calls[0][0].email).toBe('jdoe@x.edu')
    expect(mockMailer.sendSetPasswordEmail.mock.calls[0][1]).toMatch(/^[a-f0-9]{64}$/)
  })

  it('assigns an existing account that matches on both username and email', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
    mockPrisma.$queryRaw.mockResolvedValue([EXISTING_USER])
    mockPrisma.assignment.findUnique.mockResolvedValue(null)

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@x.edu>' })

    expect(res.status).toBe(200)
    expect(res.body.created).toBe(0)
    expect(res.body.assigned).toBe(1)
    expect(res.body.already_assigned).toBe(0)
    expect(res.body.results.map(r => r.status)).toEqual(['assigned'])
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
    expect(mockPrisma.assignment.create).toHaveBeenCalledWith({ data: { student_id: EXISTING_USER.id, project_id: TEST_PROJECT.id } })
    expect(mockMailer.sendSetPasswordEmail).not.toHaveBeenCalled()
  })

  it('matches existing accounts case-insensitively', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 5, username: 'jdoe', email: 'jdOE@x.edu' }])
    mockPrisma.assignment.findUnique.mockResolvedValue(null)

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <JDoe@x.edu>' })

    expect(res.status).toBe(200)
    expect(res.body.assigned).toBe(1)
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
  })

  it('marks an existing account already in the project as already-assigned', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
    mockPrisma.$queryRaw.mockResolvedValue([EXISTING_USER])
    mockPrisma.assignment.findUnique.mockResolvedValue({ student_id: EXISTING_USER.id, project_id: TEST_PROJECT.id })

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@x.edu>' })

    expect(res.status).toBe(200)
    expect(res.body.already_assigned).toBe(1)
    expect(res.body.assigned).toBe(0)
    expect(res.body.results.map(r => r.status)).toEqual(['already-assigned'])
    expect(mockPrisma.assignment.create).not.toHaveBeenCalled()
  })

  it('reports a username conflict as an error and creates nothing', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
    // Username 'jdoe' exists but belongs to a different email
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 7, username: 'jdoe', email: 'other@x.edu' }])

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@new.edu>' })

    expect(res.status).toBe(200)
    expect(res.body.created).toBe(0)
    expect(res.body.errors).toHaveLength(1)
    expect(res.body.errors[0].reason).toContain("Username 'jdoe'")
    expect(res.body.errors[0].reason).toContain('other@x.edu')
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
    expect(mockPrisma.assignment.create).not.toHaveBeenCalled()
  })

  it('reports an email conflict as an error and creates nothing', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
    // Email exists but belongs to a different username
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 7, username: 'jdoe', email: 'other@new.edu' }])

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <other@new.edu>' })

    expect(res.status).toBe(200)
    expect(res.body.created).toBe(0)
    expect(res.body.errors).toHaveLength(1)
    expect(res.body.errors[0].reason).toContain("Email 'other@new.edu'")
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
  })

  it('reports a conflict when username and email match two different accounts', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
    mockPrisma.$queryRaw.mockResolvedValue([
      { id: 7, username: 'jdoe', email: 'a@x.edu' },
      { id: 8, username: 'other', email: 'jdoe@new.edu' }
    ])

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@new.edu>' })

    expect(res.status).toBe(200)
    expect(res.body.created).toBe(0)
    expect(res.body.errors).toHaveLength(1)
    expect(res.body.errors[0].reason).toContain('a@x.edu')
    expect(res.body.errors[0].reason).toContain('jdoe@new.edu')
    expect(mockPrisma.user.create).not.toHaveBeenCalled()
  })

  it('processes a mixed batch: creates the good entries and reports the bad ones', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
    let calls = 0
    mockPrisma.$queryRaw.mockImplementation(async () => {
      calls++
      return calls === 1 ? [] : [{ id: 7, username: 'jsmith', email: 'other@x.edu' }]
    })
    let nextId = 100
    mockPrisma.user.create.mockImplementation(async ({ data }) => ({ id: ++nextId, ...data }))
    mockPrisma.assignment.findUnique.mockResolvedValue(null)

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@x.edu>\nSmith, Jane <jsmith@x.edu>' })

    expect(res.status).toBe(200)
    expect(res.body.created).toBe(1)
    expect(res.body.total).toBe(2)
    expect(res.body.results.map(r => r.status)).toEqual(['created'])
    expect(res.body.errors).toHaveLength(1)
    expect(res.body.errors[0].index).toBe(2)
  })

  it('reports email delivery failures without failing the request', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
    mockPrisma.$queryRaw.mockResolvedValue([])
    let nextId = 100
    mockPrisma.user.create.mockImplementation(async ({ data }) => ({ id: ++nextId, ...data }))
    mockPrisma.assignment.findUnique.mockResolvedValue(null)
    mockMailer.sendSetPasswordEmail.mockRejectedValue(new Error('SMTP down'))

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@x.edu>' })

    expect(res.status).toBe(200)
    expect(res.body.created).toBe(1)
    expect(res.body.email_failures).toEqual(['jdoe@x.edu'])
  })

  it('returns 500 when the database fails', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT)
    mockPrisma.$queryRaw.mockRejectedValue(new Error('DB down'))

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@x.edu>' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to bulk create users')
  })

  it('allows a teacher to bulk-create for a project in their own offering', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(TEST_PROJECT) // offering_id: 1
    mockPrisma.offering.findUnique.mockResolvedValue({ id: 1, teacher_id: 20 }) // TEACHER_TOKEN sub = 20
    mockPrisma.$queryRaw.mockResolvedValue([])
    let nextId = 100
    mockPrisma.user.create.mockImplementation(async ({ data }) => ({ id: ++nextId, ...data }))
    mockPrisma.assignment.findUnique.mockResolvedValue(null)

    const res = await request(app)
      .post('/user/bulk-create')
      .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      .send({ project_id: TEST_PROJECT.id, entries: 'Doe, John <jdoe@x.edu>' })

    expect(res.status).toBe(200)
    expect(res.body.created).toBe(1)
  })
})
