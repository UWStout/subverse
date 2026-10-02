import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { mockPrisma, TEST_USER, TEST_CLASS } from './setup.js'
import path from 'path'

// ---------------------------------------------------------------------------
// Dynamic import to get a fresh router per test (clears ESM cache + lazy getDb)
// ---------------------------------------------------------------------------
async function getUserRouter () {
  vi.resetModules()
  const routePath = path.resolve(__dirname, '..', 'server', 'routes', 'user.js')
  const mod = await import(routePath)
  return mod.default
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('User API Routes', () => {
  let router
  let app

  beforeEach(async () => {
    router = await getUserRouter()
    // Build a minimal Express app for supertest
    const express = await import('express')
    app = express.default()
    app.use('/user/', router)
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

  // ---- GET /:id ----
  describe('GET /user/:id', () => {
    it('returns 400 for non-numeric ID', async () => {
      const res = await request(app).get('/user/abc')
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: 'Invalid user ID' })
    })

    it('returns 404 when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const res = await request(app).get('/user/999')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'User not found' })
    })

    it('returns sanitized user data (no password_hash, tokens)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)

      const res = await request(app).get('/user/1')
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

      const res = await request(app).get('/user/1')
      expect(res.status).toBe(200)
      expect(res.body.taught_offerings).toHaveLength(1)
      expect(res.body.assignments).toHaveLength(1)
    })

    it('returns 500 on database error', async () => {
      mockPrisma.user.findUnique.mockRejectedValue(new Error('DB down'))

      const res = await request(app).get('/user/1')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to retrieve user' })
    })
  })

  // ---- POST /create ----
  describe('POST /user/create', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/user/create')
        .send({ username: 'u' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Missing required fields')
    })

    it('returns 409 when username is already taken', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        username: 'existing',
        email: 'other@example.com'
      })

      const res = await request(app)
        .post('/user/create')
        .send({ username: 'existing', email: 'new@example.com', password: 'pass123' })
      expect(res.status).toBe(409)
      expect(res.body.conflicts).toContain('username')
    })

    it('returns 409 when email is already taken', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        username: 'other',
        email: 'taken@example.com'
      })

      const res = await request(app)
        .post('/user/create')
        .send({ username: 'newuser', email: 'taken@example.com', password: 'pass123' })
      expect(res.status).toBe(409)
      expect(res.body.conflicts).toContain('email')
    })

    it('creates a user with default STUDENT type when type is omitted', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/create')
        .send({ username: 'testuser', email: 'test@example.com', password: 'secret' })
      expect(res.status).toBe(201)
      expect(res.body.user.type).toBe('STUDENT')
    })

    it('creates a user with specified TEACHER type', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue({ ...TEST_USER, type: 'TEACHER' })

      const res = await request(app)
        .post('/user/create')
        .send({ username: 'teacher', email: 'teacher@example.com', password: 'secret', type: 'TEACHER' })
      expect(res.status).toBe(201)
      expect(res.body.user.type).toBe('TEACHER')
    })

    it('ignores invalid user type and defaults to STUDENT', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/create')
        .send({ username: 'testuser', email: 'test@example.com', password: 'secret', type: 'INVALID_TYPE' })
      expect(res.status).toBe(201)
      expect(res.body.user.type).toBe('STUDENT')
    })

    it('returns sanitized user (no password_hash) in response', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/create')
        .send({ username: 'testuser', email: 'test@example.com', password: 'secret' })
      expect(res.body.user).not.toHaveProperty('password_hash')
    })

    it('returns 500 on database error', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .post('/user/create')
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

    it('updates username successfully', async () => {
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

    it('updates email successfully', async () => {
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

    it('updates password (hashes it)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, password_hash: '$2a$10$newhash' })

      const res = await request(app)
        .post('/user/update/1')
        .send({ password: 'newpass' })
      expect(res.status).toBe(200)
      expect(mockPrisma.user.update).toHaveBeenCalled()
    })

    it('updates user type to ADMIN', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)
      mockPrisma.user.update.mockResolvedValue({ ...TEST_USER, type: 'ADMIN' })

      const res = await request(app)
        .post('/user/update/1')
        .send({ type: 'ADMIN' })
      expect(res.status).toBe(200)
      expect(res.body.user.type).toBe('ADMIN')
    })

    it('returns 400 for invalid user type', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(TEST_USER)

      const res = await request(app)
        .post('/user/update/1')
        .send({ type: 'GOD' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid user type')
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
      mockPrisma.user.findUnique.mockRejectedValue(new Error('DB down'))

      const res = await request(app)
        .post('/user/update/1')
        .send({ username: 'x' })
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'Failed to update user' })
    })
  })
})
