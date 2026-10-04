import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { mockPrisma, TEST_JWT_SECRET } from './setup.js'
import path from 'path'

// ---------------------------------------------------------------------------
// Dynamic import to get a fresh router per test (clears ESM cache + lazy getDb)
// ---------------------------------------------------------------------------
async function getAuthRouter () {
  vi.resetModules()
  const routePath = path.resolve(__dirname, '..', 'routes', 'auth.js')
  const mod = await import(routePath)
  return mod.default
}

/** A valid bootstrap token signed with the pinned test secret. */
function makeBootstrapToken (payloadOverrides = {}, options = {}) {
  return jwt.sign(
    { purpose: 'bootstrap', jti: 'test-jti', ...payloadOverrides },
    TEST_JWT_SECRET,
    { expiresIn: '5m', ...options }
  )
}

const BOOTSTRAP_BODY = {
  token: makeBootstrapToken(),
  username: 'rootadmin',
  email: 'root@example.com',
  password: 'sup3r-secret',
  first_name: 'Root',
  last_name: 'Admin'
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Bootstrap API Routes', () => {
  let router
  let app

  beforeEach(async () => {
    router = await getAuthRouter()
    const express = await import('express')
    app = express.default()
    app.use('/auth/', router)
  })

  // ---- GET /bootstrap/status ----
  describe('GET /auth/bootstrap/status', () => {
    it('reports bootstrap mode when the users table is empty', async () => {
      mockPrisma.user.count.mockResolvedValue(0)

      const res = await request(app).get('/auth/bootstrap/status')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ bootstrap: true })
    })

    it('reports normal mode when accounts already exist', async () => {
      mockPrisma.user.count.mockResolvedValue(3)

      const res = await request(app).get('/auth/bootstrap/status')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ bootstrap: false })
    })
  })

  // ---- POST /bootstrap ----
  describe('POST /auth/bootstrap', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/auth/bootstrap')
        .send({ username: 'rootadmin', email: 'root@example.com', password: 'x' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/required/i)
    })

    it('returns 410 when an account already exists, even with a valid token', async () => {
      mockPrisma.user.count.mockResolvedValue(1)

      const res = await request(app)
        .post('/auth/bootstrap')
        .send(BOOTSTRAP_BODY)
      expect(res.status).toBe(410)
      expect(res.body.error).toMatch(/already/i)
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
    })

    it('returns 401 for a token signed with the wrong secret', async () => {
      const forged = jwt.sign(
        { purpose: 'bootstrap', jti: 'forged' },
        'not-the-real-secret',
        { expiresIn: '5m' }
      )

      const res = await request(app)
        .post('/auth/bootstrap')
        .send({ ...BOOTSTRAP_BODY, token: forged })
      expect(res.status).toBe(401)
      expect(res.body.error).toMatch(/invalid/i)
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
    })

    it('returns 401 for a validly-signed token that is not a bootstrap token', async () => {
      const sessionToken = jwt.sign(
        { sub: 1, username: 'testuser', type: 'STUDENT' },
        TEST_JWT_SECRET,
        { expiresIn: '5m' }
      )

      const res = await request(app)
        .post('/auth/bootstrap')
        .send({ ...BOOTSTRAP_BODY, token: sessionToken })
      expect(res.status).toBe(401)
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
    })

    it('returns 400 for an expired bootstrap token', async () => {
      const expired = makeBootstrapToken({}, { expiresIn: '-5m' })

      const res = await request(app)
        .post('/auth/bootstrap')
        .send({ ...BOOTSTRAP_BODY, token: expired })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/expired/i)
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
    })

    it('creates the initial account as an ADMIN and returns a sanitized user', async () => {
      mockPrisma.user.count.mockResolvedValue(0)
      mockPrisma.user.create.mockImplementation(async ({ data }) => ({
        id: 1,
        username: data.username,
        email: data.email,
        password_hash: data.password_hash,
        type: data.type,
        first_name: data.first_name,
        last_name: data.last_name,
        verification_token: null,
        verification_sent_at: null,
        reset_token: null,
        reset_sent_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }))

      const res = await request(app)
        .post('/auth/bootstrap')
        .send(BOOTSTRAP_BODY)
      expect(res.status).toBe(201)

      // The password must be hashed, never stored in plain text
      expect(bcrypt.hash).toHaveBeenCalledWith('sup3r-secret', 10)

      // The account is created with the ADMIN type
      const createCall = mockPrisma.user.create.mock.calls[0][0]
      expect(createCall.data.type).toBe('ADMIN')
      expect(createCall.data.username).toBe('rootadmin')
      expect(createCall.data.email).toBe('root@example.com')
      expect(createCall.data.password_hash).toBe('$2a$10$hashedpassword')

      // The response echoes the user without sensitive fields
      expect(res.body.user.type).toBe('ADMIN')
      expect(res.body.user.username).toBe('rootadmin')
      expect(res.body.user).not.toHaveProperty('password_hash')
    })

    it('treats omitted first/last names as null', async () => {
      mockPrisma.user.count.mockResolvedValue(0)
      mockPrisma.user.create.mockResolvedValue({ id: 1, type: 'ADMIN' })

      const res = await request(app)
        .post('/auth/bootstrap')
        .send({ token: BOOTSTRAP_BODY.token, username: 'rootadmin', email: 'root@example.com', password: 'sup3r-secret' })
      expect(res.status).toBe(201)

      const createCall = mockPrisma.user.create.mock.calls[0][0]
      expect(createCall.data.first_name).toBeNull()
      expect(createCall.data.last_name).toBeNull()
    })
  })
})
