import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { mockPrisma, TEST_USER, authedApp, makeToken } from './setup.js'
import path from 'path'

// ---------------------------------------------------------------------------
// Dynamic import to get a fresh router per test (clears ESM cache + lazy getDb)
// ---------------------------------------------------------------------------
async function getUserRouter () {
  vi.resetModules()
  const routePath = path.resolve(__dirname, '..', 'routes', 'user.js')
  const mod = await import(routePath)
  return mod.default
}

// ---------------------------------------------------------------------------
// Role fixtures - the default authedApp token is a STUDENT (sub=1). Tests that
// need other roles set an explicit Authorization header with these tokens.
// ---------------------------------------------------------------------------
const ADMIN_TOKEN = makeToken({ sub: 10, username: 'admin', type: 'ADMIN' })
const TEACHER_TOKEN = makeToken({ sub: 20, username: 'teacher', type: 'TEACHER' })

/** A teacher account matching TEACHER_TOKEN (id/sub = 20). */
const TEACHER_SELF = { ...TEST_USER, id: 20, username: 'teacher', email: 'teacher@example.com', type: 'TEACHER' }
/** A different teacher account (not the token owner). */
const OTHER_TEACHER = { ...TEST_USER, id: 21, username: 'otherteacher', email: 'other@teacher.com', type: 'TEACHER' }
/** An admin account matching ADMIN_TOKEN (id/sub = 10). */
const ADMIN_SELF = { ...TEST_USER, id: 10, username: 'admin', email: 'admin@example.com', type: 'ADMIN' }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('User API Routes', () => {
  let router
  let app

  beforeEach(async () => {
    router = await getUserRouter()
    // Build a minimal Express app for supertest, wrapped so every request
    // carries a valid session token (simulates an authenticated client)
    const express = await import('express')
    const rawApp = express.default()
    rawApp.use('/user/', router)
    app = authedApp(rawApp)
  })

  // ---- GET /check/:username/:email ----
  describe('GET /user/check/:username/:email', () => {
    it('returns available:true when username and email are both free', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)

      const res = await request(app)
        .get('/user/check/newuser/new@example.com')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ available: true })
    })

    it('returns conflicts when username is taken', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        username: 'takenuser',
        email: 'other@example.com'
      })

      const res = await request(app)
        .get('/user/check/takenuser/free@example.com')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ available: false, conflicts: ['username'] })
    })

    it('returns conflicts when email is taken', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        username: 'otheruser',
        email: 'taken@example.com'
      })

      const res = await request(app)
        .get('/user/check/freeuser/taken@example.com')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ available: false, conflicts: ['email'] })
    })

    it('returns both conflicts when username and email are taken by same user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        username: 'takenuser',
        email: 'taken@example.com'
      })

      const res = await request(app)
        .get('/user/check/takenuser/taken@example.com')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ available: false, conflicts: ['username', 'email'] })
    })

    it('returns 500 on database error', async () => {
      mockPrisma.user.findFirst.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .get('/user/check/user/email@example.com')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to check availability' })
    })
  })

  // ---- GET /list/:type ----
  describe('GET /user/list/:type', () => {
    it('returns users with pagination metadata for teachers', async () => {
      mockPrisma.user.findMany.mockResolvedValue([TEST_USER])
      mockPrisma.user.aggregate.mockResolvedValue({ _count: { _all: 1 } })

      const res = await request(app)
        .get('/user/list/STUDENT')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.total).toBe(1)
    })

    it('returns users for admins', async () => {
      mockPrisma.user.findMany.mockResolvedValue([TEST_USER])
      mockPrisma.user.aggregate.mockResolvedValue({ _count: { _all: 1 } })

      const res = await request(app)
        .get('/user/list/*')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
    })

    it('returns 403 for students', async () => {
      const res = await request(app)
        .get('/user/list/STUDENT')
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/students/i)
    })

    it('returns 400 for an invalid type filter (non-student)', async () => {
      const res = await request(app)
        .get('/user/list/GOD')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid user type')
    })

    it('returns users matching any type in a comma-separated list', async () => {
      mockPrisma.user.findMany.mockResolvedValue([TEST_USER])
      mockPrisma.user.aggregate.mockResolvedValue({ _count: { _all: 1 } })

      const res = await request(app)
        .get('/user/list/TEACHER,ADMIN')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(200)
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: { in: ['TEACHER', 'ADMIN'] } } }))
    })

    it('returns 400 when any type in a comma-separated list is invalid (non-student)', async () => {
      const res = await request(app)
        .get('/user/list/TEACHER,GOD')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid user type')
    })
  })

  // ---- GET /:id ----
  describe('GET /user/:id', () => {
    it('returns the student\'s own sanitized account (student, self)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER) // id=1 = sub

      const res = await request(app).get('/user/1')
      expect(res.status).toBe(200)
      expect(res.body.username).toBe('testuser')
      expect(res.body.email).toBe('test@example.com')
      expect(res.body).not.toHaveProperty('password_hash')
      expect(res.body).not.toHaveProperty('verification_token')
      expect(res.body).not.toHaveProperty('reset_token')
    })

    it('returns 403 when a student tries to view another account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...TEST_USER, id: 2 })

      const res = await request(app).get('/user/2')
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/students can only view their own/i)
    })

    it('returns 400 for non-numeric ID (teacher)', async () => {
      const res = await request(app)
        .get('/user/abc')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid user ID' })
    })

    it('returns 404 when user does not exist (teacher)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .get('/user/999')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'User not found' })
    })

    it('returns sanitized user data (no password_hash, tokens)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .get('/user/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(200)
      expect(res.body).not.toHaveProperty('password_hash')
      expect(res.body).not.toHaveProperty('verification_token')
      expect(res.body).not.toHaveProperty('reset_token')
      expect(res.body.username).toBe('testuser')
      expect(res.body.email).toBe('test@example.com')
    })

    it('includes taught_offerings and assignments when present', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...TEST_USER,
        taught_offerings: [{ id: 1 }],
        assignments: [{ student_id: 1, project_id: 1 }]
      })

      const res = await request(app)
        .get('/user/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(200)
      expect(res.body.taught_offerings).toHaveLength(1)
      expect(res.body.assignments).toHaveLength(1)
    })

    it('returns 500 on database error (admin)', async () => {
      // First findUnique call is requireVerified's requester check (passes);
      // the route's own lookup fails.
      let calls = 0
      mockPrisma.user.findUnique.mockImplementation(async () => {
        calls += 1
        if (calls === 1) return TEST_USER
        throw new Error('DB down')
      })

      const res = await request(app)
        .get('/user/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to retrieve user' })
    })
  })

  // ---- POST /create ----
  describe('POST /user/create', () => {
    it('returns 403 for students (even with a complete body)', async () => {
      const res = await request(app)
        .post('/user/create')
        .send({ username: 'newuser', email: 'new@example.com', password: 'secret' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/students/i)
    })

    it('returns 400 when required fields are missing (admin)', async () => {
      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ username: 'u' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Missing required fields')
    })

    it('returns 409 when username is already taken (admin)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        username: 'existing',
        email: 'other@example.com'
      })

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ username: 'existing', email: 'new@example.com', password: 'pass123' })
      expect(res.status).toBe(409)
      expect(res.body.conflicts).toContain('username')
    })

    it('returns 409 when email is already taken (admin)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        username: 'other',
        email: 'taken@example.com'
      })

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ username: 'newuser', email: 'taken@example.com', password: 'pass123' })
      expect(res.status).toBe(409)
      expect(res.body.conflicts).toContain('email')
    })

    it('creates a user with default STUDENT type when type is omitted (admin)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ username: 'testuser', email: 'test@example.com', password: 'secret' })
      expect(res.status).toBe(201)
      expect(res.body.user.type).toBe('STUDENT')
    })

    it('creates a user with specified TEACHER type (admin)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue({ ...TEST_USER, type: 'TEACHER' })

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ username: 'teacher', email: 'teacher@example.com', password: 'secret', type: 'TEACHER' })
      expect(res.status).toBe(201)
      expect(res.body.user.type).toBe('TEACHER')
    })

    it('creates an ADMIN account when the requester is an admin', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue({ ...TEST_USER, type: 'ADMIN' })

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ username: 'admin2', email: 'admin2@example.com', password: 'secret', type: 'ADMIN' })
      expect(res.status).toBe(201)
      expect(res.body.user.type).toBe('ADMIN')
    })

    it('creates a user with first_name and last_name (admin)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue({ ...TEST_USER, first_name: 'Alice', last_name: 'Smith' })

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ username: 'alice', email: 'alice@example.com', password: 'secret', first_name: 'Alice', last_name: 'Smith' })
      expect(res.status).toBe(201)
      expect(res.body.user.first_name).toBe('Alice')
      expect(res.body.user.last_name).toBe('Smith')
    })

    it('creates a user with null first_name and last_name when omitted (admin)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue({ ...TEST_USER, first_name: null, last_name: null })

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ username: 'noname', email: 'noname@example.com', password: 'secret' })
      expect(res.status).toBe(201)
      expect(res.body.user.first_name).toBeNull()
      expect(res.body.user.last_name).toBeNull()
    })

    it('ignores invalid user type and defaults to STUDENT (admin)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ username: 'testuser', email: 'test@example.com', password: 'secret', type: 'INVALID_TYPE' })
      expect(res.status).toBe(201)
      expect(res.body.user.type).toBe('STUDENT')
    })

    it('creates a STUDENT account when the requester is a teacher', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ username: 'newstudent', email: 'newstudent@example.com', password: 'secret', type: 'STUDENT' })
      expect(res.status).toBe(201)
      expect(res.body.user.type).toBe('STUDENT')
    })

    it('creates a TEACHER account when the requester is a teacher', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue({ ...TEST_USER, type: 'TEACHER' })

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ username: 'newteacher', email: 'newteacher@example.com', password: 'secret', type: 'TEACHER' })
      expect(res.status).toBe(201)
      expect(res.body.user.type).toBe('TEACHER')
    })

    it('returns 403 when a teacher tries to create an ADMIN account', async () => {
      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ username: 'newadmin', email: 'newadmin@example.com', password: 'secret', type: 'ADMIN' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/teachers cannot create admin/i)
    })

    it('returns sanitized user (no password_hash) in response (admin)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ username: 'testuser', email: 'test@example.com', password: 'secret' })
      expect(res.body.user).not.toHaveProperty('password_hash')
    })

    it('returns 500 on database error (admin)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .post('/user/create')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ username: 'u', email: 'u@e.com', password: 'p' })
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to create user' })
    })
  })

  // ---- POST /update/:id ----
  describe('POST /user/update/:id', () => {
    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app)
        .post('/user/update/abc')
        .send({})
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid user ID' })
    })

    it('returns 400 when no update fields are provided', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/update/1')
        .send({})
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'No update fields provided' })
    })

    it('returns 404 when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .post('/user/update/999')
        .send({ username: 'new' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'User not found' })
    })

    it('updates username successfully (student, own account)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.findFirst.mockResolvedValue(null) // no duplicate
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, username: 'newname' })

      const res = await request(app)
        .post('/user/update/1')
        .send({ username: 'newname' })
      expect(res.status).toBe(200)
      expect(res.body.user.username).toBe('newname')
    })

    it('returns 409 when new username is already taken by another user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.findFirst.mockResolvedValue({ id: 2, username: 'taken' })

      const res = await request(app)
        .post('/user/update/1')
        .send({ username: 'taken' })
      expect(res.status).toBe(409)
      expect(res.body).toEqual({ error: 'Username already in use' })
    })

    it('updates email successfully (student, own account)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.findFirst.mockResolvedValue(null) // no duplicate
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, email: 'new@example.com' })

      const res = await request(app)
        .post('/user/update/1')
        .send({ email: 'new@example.com' })
      expect(res.status).toBe(200)
      expect(res.body.user.email).toBe('new@example.com')
    })

    it('returns 409 when new email is already taken by another user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.findFirst.mockResolvedValue({ id: 2, email: 'taken@other.com' })

      const res = await request(app)
        .post('/user/update/1')
        .send({ email: 'taken@other.com' })
      expect(res.status).toBe(409)
      expect(res.body).toEqual({ error: 'Email already in use' })
    })

    it('updates password (hashes it) (student, own account)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, password_hash: '$2a$10$newhash' })

      const res = await request(app)
        .post('/user/update/1')
        .send({ password: 'newpass' })
      expect(res.status).toBe(200)
      const updateArgs = mockPrisma.user.update.mock.calls[0][0]
      expect(updateArgs.data.password_hash).toBe('$2a$10$hashedpassword') // mocked bcrypt hash
    })

    it('keeps current password when the password field is omitted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, first_name: 'Jane' })

      const res = await request(app)
        .post('/user/update/1')
        .send({ first_name: 'Jane' })
      expect(res.status).toBe(200)
      const updateArgs = mockPrisma.user.update.mock.calls[0][0]
      expect(updateArgs.data).not.toHaveProperty('password_hash')
    })

    it('keeps current password when the password field is an empty string', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, first_name: 'Jane' })

      const res = await request(app)
        .post('/user/update/1')
        .send({ password: '', first_name: 'Jane' })
      expect(res.status).toBe(200)
      const updateArgs = mockPrisma.user.update.mock.calls[0][0]
      expect(updateArgs.data).not.toHaveProperty('password_hash')
    })

    it('updates first_name and last_name successfully (student, own account)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, first_name: 'Jane', last_name: 'Doe' })

      const res = await request(app)
        .post('/user/update/1')
        .send({ first_name: 'Jane', last_name: 'Doe' })
      expect(res.status).toBe(200)
      expect(res.body.user.first_name).toBe('Jane')
      expect(res.body.user.last_name).toBe('Doe')
    })

    it('clears first_name and last_name when set to empty string', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, first_name: null, last_name: null })

      const res = await request(app)
        .post('/user/update/1')
        .send({ first_name: '', last_name: '' })
      expect(res.status).toBe(200)
      expect(res.body.user.first_name).toBeNull()
      expect(res.body.user.last_name).toBeNull()
    })

    it('returns sanitized user in response (no password_hash)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/update/1')
        .send({ username: 'updated' })
      expect(res.body.user).not.toHaveProperty('password_hash')
    })

    it('returns 500 on database error', async () => {
      // First findUnique call is requireVerified's requester check (passes);
      // the route's own lookup fails.
      let calls = 0
      mockPrisma.user.findUnique.mockImplementation(async () => {
        calls += 1
        if (calls === 1) return TEST_USER
        throw new Error('DB down')
      })

      const res = await request(app)
        .post('/user/update/1')
        .send({ username: 'x' })
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to update user' })
    })
  })

  // ---- POST /update/:id - role-based authorization ----
  describe('POST /user/update/:id (authorization)', () => {
    it('returns 403 when a student tries to update another account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...TEST_USER, id: 2 })

      const res = await request(app)
        .post('/user/update/2')
        .send({ username: 'hacked' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/students can only update their own/i)
    })

    it('returns 403 when a student tries to change their own type', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/update/1')
        .send({ type: 'ADMIN' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/only admins can change a user type/i)
    })

    it('updates a student account when the requester is a teacher', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER) // target: STUDENT id=1
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, username: 'renamed' })

      const res = await request(app)
        .post('/user/update/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ username: 'renamed' })
      expect(res.status).toBe(200)
      expect(res.body.user.username).toBe('renamed')
    })

    it('updates their own account when the requester is a teacher', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEACHER_SELF) // target: TEACHER id=20 = sub
      mockPrisma.user.update.mockResolvedValue({ ...TEACHER_SELF, email: 'new@teacher.com' })

      const res = await request(app)
        .post('/user/update/20')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ email: 'new@teacher.com' })
      expect(res.status).toBe(200)
      expect(res.body.user.email).toBe('new@teacher.com')
    })

    it('returns 403 when a teacher tries to update another teacher', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(OTHER_TEACHER) // target: TEACHER id=21 ≠ sub

      const res = await request(app)
        .post('/user/update/21')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ username: 'hacked' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/teachers can only update student accounts or their own/i)
    })

    it('returns 403 when a teacher tries to change a student\'s type', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER) // target: STUDENT id=1

      const res = await request(app)
        .post('/user/update/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
        .send({ type: 'TEACHER' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/only admins can change a user type/i)
    })

    it('returns 400 for an invalid user type (admin)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/update/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ type: 'GOD' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid user type')
    })

    it('updates a user\'s type when the requester is an admin', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, type: 'ADMIN' })

      const res = await request(app)
        .post('/user/update/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ type: 'ADMIN' })
      expect(res.status).toBe(200)
      expect(res.body.user.type).toBe('ADMIN')
    })

    it('updates any account when the requester is an admin (including another teacher)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(OTHER_TEACHER)
      mockPrisma.user.update.mockResolvedValue({ ...OTHER_TEACHER, first_name: 'Updated' })

      const res = await request(app)
        .post('/user/update/21')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ first_name: 'Updated' })
      expect(res.status).toBe(200)
      expect(res.body.user.first_name).toBe('Updated')
    })
  })

  // ---- Last-admin protection on type change (requirement 4) ----
  describe('POST /user/update/:id (last admin protection)', () => {
    it('returns 403 when demoting the last remaining admin account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(ADMIN_SELF) // target: ADMIN id=10
      mockPrisma.user.count.mockResolvedValue(1) // only one admin exists

      const res = await request(app)
        .post('/user/update/10')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ type: 'TEACHER' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/last admin/i)
      expect(mockPrisma.user.update).not.toHaveBeenCalled()
    })

    it('returns 403 when demoting the last admin even to STUDENT', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(ADMIN_SELF)
      mockPrisma.user.count.mockResolvedValue(1)

      const res = await request(app)
        .post('/user/update/10')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ type: 'STUDENT' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/last admin/i)
    })

    it('allows demoting an admin when another admin still exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(ADMIN_SELF)
      mockPrisma.user.count.mockResolvedValue(2) // a second admin exists
      mockPrisma.user.update.mockResolvedValue({ ...ADMIN_SELF, type: 'TEACHER' })

      const res = await request(app)
        .post('/user/update/10')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ type: 'TEACHER' })
      expect(res.status).toBe(200)
      expect(res.body.user.type).toBe('TEACHER')
    })

    it('allows an admin to re-set the last admin\'s type to ADMIN (no demotion)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(ADMIN_SELF)
      mockPrisma.user.update.mockResolvedValue(ADMIN_SELF)

      const res = await request(app)
        .post('/user/update/10')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ type: 'ADMIN' })
      expect(res.status).toBe(200)
      // count() must not even be consulted when the type stays ADMIN
      expect(mockPrisma.user.count).not.toHaveBeenCalled()
    })

    it('does not consult the admin count when a non-admin target is updated', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER) // target: STUDENT
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, type: 'TEACHER' })

      const res = await request(app)
        .post('/user/update/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({ type: 'TEACHER' })
      expect(res.status).toBe(200)
      expect(mockPrisma.user.count).not.toHaveBeenCalled()
    })
  })

  // ---- DELETE /:id ----
  describe('DELETE /user/:id', () => {
    it('returns 403 for students', async () => {
      const res = await request(app).delete('/user/1')
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/students cannot delete/i)
    })

    it('deletes a student account when the requester is a teacher', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER) // target: STUDENT id=1
      mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.user.delete.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .delete('/user/1')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(200)
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 1 } })
    })

    it('deletes another teacher account when the requester is a teacher', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(OTHER_TEACHER) // target: TEACHER id=21
      mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.user.delete.mockResolvedValue(OTHER_TEACHER)

      const res = await request(app)
        .delete('/user/21')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(200)
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 21 } })
    })

    it('deletes their own account when the requester is a teacher', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEACHER_SELF) // target: TEACHER id=20 = sub
      mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.user.delete.mockResolvedValue(TEACHER_SELF)

      const res = await request(app)
        .delete('/user/20')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(200)
    })

    it('returns 403 when a teacher tries to delete an admin account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(ADMIN_SELF) // target: ADMIN id=10

      const res = await request(app)
        .delete('/user/10')
        .set('Authorization', `Bearer ${TEACHER_TOKEN}`)
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/teachers cannot delete admin/i)
      expect(mockPrisma.user.delete).not.toHaveBeenCalled()
    })

    it('returns 400 for non-numeric ID (admin)', async () => {
      const res = await request(app)
        .delete('/user/abc')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid user ID' })
    })

    it('returns 404 when user does not exist (admin)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const res = await request(app)
        .delete('/user/999')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'User not found' })
    })

    it('deletes a non-admin user successfully (admin)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER) // target: STUDENT
      mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.user.delete.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .delete('/user/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(200)
      expect(res.body.message).toMatch(/delet/i)
    })

    it('cascades deletion of associated assignments (admin)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 3 })
      mockPrisma.user.delete.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .delete('/user/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(200)
      expect(mockPrisma.assignment.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { student_id: 1 } })
      )
    })

    it('returns 500 on database error during lookup (admin)', async () => {
      // First findUnique call is requireVerified's requester check (passes);
      // the route's own lookup fails.
      let calls = 0
      mockPrisma.user.findUnique.mockImplementation(async () => {
        calls += 1
        if (calls === 1) return TEST_USER
        throw new Error('DB down')
      })

      const res = await request(app)
        .delete('/user/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to delete user' })
    })

    it('returns 500 on database error during deletion (admin)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.user.delete.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .delete('/user/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to delete user' })
    })
  })

  // ---- Last-admin protection on delete (requirement 4) ----
  describe('DELETE /user/:id (last admin protection)', () => {
    it('returns 403 when deleting the last remaining admin account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(ADMIN_SELF) // target: ADMIN id=10
      mockPrisma.user.count.mockResolvedValue(1)

      const res = await request(app)
        .delete('/user/10')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/last admin/i)
      expect(mockPrisma.user.delete).not.toHaveBeenCalled()
    })

    it('returns 403 when an admin tries to delete their own account as the last admin', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(ADMIN_SELF) // id=10 = sub (self-delete)
      mockPrisma.user.count.mockResolvedValue(1)

      const res = await request(app)
        .delete('/user/10')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/last admin/i)
    })

    it('allows deleting an admin when another admin still exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(ADMIN_SELF)
      mockPrisma.user.count.mockResolvedValue(2)
      mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.user.delete.mockResolvedValue(ADMIN_SELF)

      const res = await request(app)
        .delete('/user/10')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(200)
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 10 } })
    })

    it('does not consult the admin count when deleting a non-admin', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER) // target: STUDENT
      mockPrisma.assignment.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.user.delete.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .delete('/user/1')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      expect(res.status).toBe(200)
      expect(mockPrisma.user.count).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// Authentication - every route on this router requires a valid session token
// ---------------------------------------------------------------------------
describe('Authentication', () => {
  let app

  beforeEach(async () => {
    const router = await getUserRouter()
    const express = await import('express')
    app = express.default()
    app.use('/user/', router)
  })

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/user/list/STUDENT')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/authorization/i)
  })

  it('returns 401 for a malformed Authorization header', async () => {
    const res = await request(app)
      .get('/user/list/STUDENT')
      .set('Authorization', 'Token abc123')
    expect(res.status).toBe(401)
  })

  it('returns 401 for a token signed with the wrong secret', async () => {
    const badToken = jwt.sign({ sub: 1, username: 'testuser' }, 'wrong-secret', { expiresIn: '8h' })
    const res = await request(app)
      .get('/user/list/STUDENT')
      .set('Authorization', `Bearer ${badToken}`)
    expect(res.status).toBe(401)
  })
})
